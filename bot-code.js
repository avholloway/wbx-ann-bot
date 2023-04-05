import fs from 'fs';
import got from 'got';
import crypto from 'crypto';
import stream from 'stream';
import FormData from 'form-data';
import { promisify } from 'util';
import { NodeHtmlMarkdown } from 'node-html-markdown';

export default defineComponent({
  async run({ steps, $ }) {

    // if you type /send hello world, should I send it?  Set this value to some minimum
    // number of words I should expect from you, in order for me to send it out
    const MINIMUM_WORD_COUNT = 3;

    // custom logging function which takes infinite parameters of things to log
    const log = (...msg) => console.log('INFO:', ...msg);
    log("start of webhook processing")
    
    // authenticated webhook processing
    // json body is hashed using a known secret when setting up webhook
    // and that sha1 hash is sent to us in the following header
    const sender_hash = steps.trigger.event.headers["x-spark-signature"];

    // we need to create the same hash of the json body using the same secret
    const computed_hash = crypto
      .createHmac('sha1', process.env.ANNOUNCE_SECRET)
      .update(JSON.stringify(steps.trigger.event.body))
      .digest('hex');

    // if the hashes do not match, then the secrets do not match, therefore, we do not trust this message
    if (sender_hash !== computed_hash)
      return $.flow.exit('Secret Mismatch: An unauthorized message was sent to us.');

    // in order for this bot to be useful, it must be able to post messages
    // so let's see if the bot's access token was stored for us to use
    const bot_token = process.env.ANNOUNCE_BOT_TOKEN;
    if (!bot_token)
      return $.flow.exit('environment variable missing or empty: ANNOUNCE_BOT_TOKEN');

    // another key aspect of this bot is the admin room, so let's see if we have
    // the admin room id, to be able to communicate with the admins
    const admin_room = process.env.ANNOUNCE_ADMIN_ROOM;
    if (!admin_room)
      return $.flow.exit('environment variable missing or empty: ANNOUNCE_ADMIN_ROOM');

    // we be sending quite a few web requests to webex, so let's setup some defaults
    const webex_api_options = {
      prefixUrl: 'https://webexapis.com/v1',
      headers: {
        'Authorization': `Bearer ${bot_token}`
      },
      timeout: { request: 30000 },
      retry: {
        methods: [...got.defaults.options.retry.methods, 'POST'],
        maxRetryAfter: 60
      }
    };

    // let's create a custom got client using said defaults
    const got_api_client = got.extend(webex_api_options);

    // and then one more custom got client for downloading files, but overriding
    // the prefixUrl, as it's different for file downloads
    const got_file_client = got.extend({
      ...webex_api_options,
      prefixUrl: '',
    });

    // let's setup a convenience function for sending messages into a room
    // while allowing for an optional parent messag to reply to (message threads)
    async function send_message(room, message, parent = undefined) {
      log('fn send_message');
      log({message});
      try {
        await got_api_client.post('messages', {json: {
          roomId: room,
          markdown: message,
          ...(parent && { parentId: parent })
        }});
        log('success');
        return true;
      } catch(error) {
        log({error});
        return false;
      }
    }

    // a convenience function for sending admin alerts during processing
    async function alert(message) {
      log('fn alert');
      try {
        await send_message(admin_room, message);
      } catch(error) {
        // swallow error
      }
    }

    // a function to turn a room into a hyperlink, which can be used in a message
    function room_link(room) {
      log('fn room_link');
      const decoded = Buffer.from(room.id, 'base64').toString();
      const pkid = decoded.split('/').pop();
      const link = `[${room.title}](webexteams://im?space=${pkid})`;
      log({link});
      return link;
    }

    // a function to turn a person into a hyperlink, which can be used in a message
    function person_link(person) {
      log('fn person_link');
      const link = `[${person.displayName}](webexteams://im?email=${person.emails[0]})`;
      log({link});
      return link;
    }

    // alias the webhook body; we'll refer to it quite a bit
    const webhook = steps.trigger.event.body;
    log({webhook});

    // we only support these two webhook resources
    if (!['memberships', 'messages'].includes(webhook.resource))
      return $.flow.exit(`resource of ${webhook.resource} not expected`);

    // we only support this one event which represents a new message or being added to a new room
    if (webhook.event !== 'created')
      return $.flow.exit(`event type of ${webhook.event} not expected`);

    // handle the first kind of resource we support
    if (webhook.resource === 'memberships') {
      log('new membership notifiction');
      try {
        // get the details of the person who added our bot to a new room
        const who = await got_api_client.get(`people/${webhook.actorId}`).json();

        // get the details of the room our bot was added to
        const where = await got_api_client.get(`rooms/${webhook.data.roomId}`).json();

        // alert the admins of this event
        await alert(`📢 ${person_link(who)} added me to ${room_link(where)}`);
      } catch(error) {
        log({body: error.response?.body}, {error});
      }
      return $.flow.exit('our bot was added to a space');
    }

    // processing messages from other bots can cause loops, so we'll just ignore them
    if (/@webex\.bot$/.test(webhook.data.personEmail))
      return $.flow.exit('this is a message from another bot, ignore it');

    // we'll need the message id from the webhook, which is the message an admin sent
    // for us to process, for two reasons: to get the message text, and to reply to it
    const message_id = webhook.data.id;

    // convenience function for us to reply to the admin's message in a thread (keeps context)
    async function respond(message) {
      log('fn respond');
      try {
        await send_message(admin_room, message, message_id);
      } catch(error) {
        // swallow error
      }
    }

    // convenience function to template how we report on webex api errors to the admins
    const api_error = error => `⚠️ Webex API Error\n\n\`\`\`\n${error}\n\`\`\``;

    // grabs the first 100 rooms our bot belongs to; the 100 is an api imposed limit
    // i could implement 429s, but i didn't want to support large room sets with this
    // groups only; all direct 1:1 spaces are excluded; filtering out admin room too
    async function room_list() {
      log('fn room_list');
      let items;

      try {
        ({ items } = await got_api_client.get('rooms?type=group').json());
      } catch (error) {
        await respond(api_error(error));
        return $.flow.exit('could not get room list');
      }

      const rooms = items.filter(item => item.id !== admin_room);
      log({rooms});

      return rooms;
    }

    // time to use out bot token to actually read the message so webex knows we're
    // authorized to read said message
    let source_message;
    try {
      ({ html: source_message } = await got_api_client.get(`messages/${message_id}`).json());
    } catch (error) {
      await respond(api_error(error));
      return $.flow.exit('could not get source message');
    }

    // since our bot is mentioned in an admin room when it's commanded, we need
    // to ignore the @mention from the message itself, before further processing
    const bot_id = webhook.createdBy;
    const bot_mention = new RegExp(`<(spark-mention).+${bot_id}.+\\/\\1>`, 'g');

    // here we strip the @mention, convert html to markdown, trim spaces off the ends
    // the reason for html -> markdown is that webex converts rich text and markdown
    // sent from the user, into html, so when we request the message, it's in html format
    // however, we cannot send html formatted messages, so we must convert it back to markdown
    // i suppose this is a little premature, because we might have been sent a command
    // which does not use formatting, but i just wanted to get it done in one spot in the code
    log('pre-transformed: ', {source_message});
    source_message = source_message.replace(bot_mention, '');
    source_message = NodeHtmlMarkdown.translate(source_message);
    source_message = source_message.trim();
    log('post-transformed: ', {source_message});

    if (/^\/help/.test(source_message)) {
      log('/help command')
      const commands = [
        ['/help',   'Displays this help'],
        ['/rooms',  'Displays a list of rooms I am in (not including this room)'],
        ['/spaces', 'Alias for \`/rooms\`'],
        ['/reach',  'Displays a count of all spaces and all people who I can reach'],
        ['/test',   'Sends a test broadcast message into this room'],
        ['/send',   'Sends a broadcast message to all the spaces I am in'],
      ].map(command => `* \`${command[0]}\` - ${command[1]}`).join('\n');

      await respond(`🤖 These are the commands I know:\n${commands}`);
      return $.flow.exit('/help command complete');
    }

    if (/^\/(rooms|spaces)/.test(source_message)) {
      log('/rooms command');
      let rooms = await room_list();
      await respond(`🚪 These are all of the rooms I am in:\n${rooms.map(room => `* ${room.title}`).join('\n')}`);
      return $.flow.exit('/rooms command complete');
    }

    // reach adds up all group spaces (excluding admin room), and then all people in all spaces
    // however, it will dedupe people who show up in more than one space, as well as
    // exclude any bot accounts it finds, giving a more accurate reach number
    if (/^\/reach/.test(source_message)) {
      log('/reach command')
      let people = [], rooms = await room_list();

      for (const room of rooms) {
        let items;

        try {
          ({ items } = await got_api_client.get(`memberships?roomId=${room.id}`).json());
        } catch(error) {
          // swallow error
        }

        items = items.filter(item => !/@webex\.bot$/.test(item.personEmail));
        items = items.map(item => item.personEmail);
        people = people.concat(items);
      }

      // this is the current javascript way of deduping an array
      people = [...new Set(people)];
      
      await respond(`📈 I have a reach of **${people.length} people**, across **${rooms.length} rooms**.`);
      return $.flow.exit('/reach command complete');
    }
    
    // the only other two commands i know are these. if it's not one of these two, 
    // then we need to ignore the command, or lack of command, and let the admins know
    if (!/^\/(send|test)/.test(source_message)) {
      await respond('🤔 I didn\'t see a command I recognized. Try sending `/help` to see which commands I understand.');
      return $.flow.exit('missing or unknown command');
    }

    // minimum word count checker
    const word_count = source_message.split(' ').length;
    if (word_count < MINIMUM_WORD_COUNT) {
      await respond(`👎🏻 The word count is at ${word_count} words, and below minimum count of ${MINIMUM_WORD_COUNT}; I will not send this.`);
      return $.flow.exit('Word count too low');
    }

    // keep the admins informed about our progress
    await respond('👍🏻 I received your message and I am processing it now.');

    // get ready to start working with some files
    const files = webhook.data.files ?? [];
    let file_name = '', file_path = '', file_url = '';

    // the webex api limits us to 1 file upon message send, so we will limit the admins as well
    if (files.length > 1) {
      await respond('💾 Webex API only supports **1** file attachment.');
      return $.flow.exit('Too many file attachments to continue');
    }
    
    if (files.length === 1) {
      try {
        // you can get the file name and size from an http head request
        const { headers } = await got_file_client.head(files[0]);
        const { 'content-length': file_size } = headers;
        log({file_size});

        // didn't even need to download the file, in order to reject it based on size
        if (file_size > 104857600)
          throw('HTTPError 500 - Maximum upload size of 100MB exceeded');

        // the malware scanning is poorly implemented, so i made a choice to let the admins know
        // that this medium file size attachment might take a while to process
        if (file_size > 52428800)
          await respond('☣️ Malware scanning can take a while on larger files');

        ({ 'content-disposition': file_name } = headers);
      } catch(error) {
        await respond(api_error(error));
        return $.flow.exit('Failed to get file attachment meta data');
      }

      // string gymnastics to pull the filename out of the header value
      file_name = file_name.match(/filename="(.+)"/)[1];
      log({file_name});

      // pipedream specific implementation of local file storage
      file_path = `/tmp/${file_name}`;
      file_url = files[0];

      // create a promise pipeline (serial execution) for downloading and saving
      // the attachment to local temp storage
      const download_and_save = promisify(stream.pipeline);

      // we need this crazy loop because there's no great way to know when
      // malware scanning has finished up with our file, and we cannot download
      // it until malware scanning is complete, so we just try to download it
      // and if we're sent a 423, we delay the number of second we're told
      // and then keep trying to download the file again; until pipedream times out
      // based on my experience, we always receive a 5 second retry-after value
      // and I tend to set pipedream to 5 minute total processing time.  this means
      // that we could possibly attempt to download this file 60 times before failing
      while (true) {
        log('attempting to download and save attachment');
        try {
          await download_and_save(
            got_file_client.stream(file_url),
            fs.createWriteStream(file_path)
          );
          break;
        } catch (error) {
          if (error.response?.statusCode === 423) {
            const { 'retry-after': retry_after } = error.response.headers;
            await new Promise(r => setTimeout(r, retry_after * 1000));
            continue;
          }
          await respond(api_error(error));
          return $.flow.exit('Failed to download and save file attachment');
        }
      }
    }

    // prep the rooms, success report and failure report variables
    let rooms = [], successes = [], failures = [];

    // if we're just sending a test message, set the rooms array
    // to only include the Admin Room itself, which is where we
    // will send out test message to (not a threaded message either)
    if (/^\/test/.test(source_message)) {
      log('/test command');
      source_message = source_message.replace('/test ', '**THIS IS A TEST MESSAGE ONLY SENT TO THIS ROOM.  REPLACE /test WITH /send TO GO LIVE.**\n');
      rooms = [{id: admin_room, title: 'This Admin Room'}];

    // however, if this is not a drill, then we need a complete room list
    } else {
      log('/send command');
      source_message = source_message.replace('/send ', '');
      rooms = await room_list();
    }

    // a slow serial room iteration loop to send the messages out
    log(`begin posting to ${rooms.length} room${rooms.length === 1 ? '' : 's'}`);
    for (const room of rooms) {
      // we're going to setup a formdata submission, since it's the only way i know
      // how to attach the file, even if we're not working with a file
      const form_data = new FormData();

      form_data.append('roomId', room.id);
      form_data.append('markdown', source_message);

      if (files.length === 1)
        form_data.append('files', fs.createReadStream(file_path));

      try {
        log(`posting to ${room.title}`);
        await got_api_client.post('messages', { body: form_data });
        successes.push(room);
      } catch (error) {
        failures.push(room);
      }
    }
    log('finished posting to rooms');

    // i wanted to use a sucess rating and some emojis to track how well we performed
    // sometimes, posting to the webex api can fail, for whatever reason, and so
    // i thought it would be nice to report on that, with a percentage of success
    let rating;
    const success_ratio = successes.length / rooms.length;
    log(`success ratio is ${Math.floor(success_ratio * 100)}%`);

    if (success_ratio === 1) {
      rating = '🥳';
    } else if (success_ratio >= .9) {
      rating = '😎';
    } else if (success_ratio >= .7) {
      rating = '🤔';
    } else if (success_ratio >= .5) {
      rating = '🤨';
    } else {
      rating = '🤬';
    }

    const success_status_report = `${successes.length} of ${rooms.length} Room${rooms.length === 1 ? '' : 's'}\n\n`;

    // if we were not successful posting to any rooms, 
    // then add the word none to the success list, so it prints in the report
    if (successes.length === 0) successes.push('None');
    successes = successes.map(room => `* ${room === 'None' ? room : room_link(room)}`);

    // and do the same thing with the failures too
    if (failures.length === 0) failures.push('None');
    failures = failures.map(room => `* ${room === 'None' ? room : room_link(room)}`);
    
    // send the final report to the admins, because we're all done
    await respond(
      `${rating} Your post was sent to ` +
      success_status_report +

      'Failures\n' +
      failures.join('\n') +

      '\n\n' +

      'Successes\n' +
      successes.join('\n')
    );
    
    // don't rely on the local temp storage, and clean up our downloaded file
    if (files.length === 1) await fs.promises.unlink(file_path);

    return $.flow.exit('Finished')
  },
});
