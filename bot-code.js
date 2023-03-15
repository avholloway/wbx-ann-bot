import fs from 'fs';
import got from 'got';
import stream from 'stream';
import FormData from 'form-data';
import { promisify } from 'util';
import { NodeHtmlMarkdown } from 'node-html-markdown';

export default defineComponent({
  async run({ steps, $ }) {

    const log = (...msg) => console.log('INFO:', ...msg);

    const bot_token = process.env.ANNOUNCE_BOT_TOKEN;
    if (!bot_token)
      return $.flow.exit('environment variable missing or empty: ANNOUNCE_BOT_TOKEN');

    const admin_room = process.env.ANNOUNCE_ADMIN_ROOM;
    if (!admin_room)
      return $.flow.exit('environment variable missing or empty: ANNOUNCE_ADMIN_ROOM');

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

    const got_api_client = got.extend(webex_api_options);
    const got_file_client = got.extend({
      ...webex_api_options,
      prefixUrl: '',
    });

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

    async function alert(message) {
      log('fn alert');
      try {
        await send_message(admin_room, message);
      } catch(error) {
        // swallow error
      }
    }

    function room_link(room) {
      log('fn room_link');
      const decoded = Buffer.from(room.id, 'base64').toString();
      const pkid = decoded.split('/').pop();
      const link = `[${room.title}](webexteams://im?space=${pkid})`;
      log({link});
      return link;
    }

    function person_link(person) {
      log('fn person_link');
      const link = `[${person.displayName}](webexteams://im?email=${person.emails[0]})`;
      log({link});
      return link;
    }

    const webhook = steps.trigger.event.body;
    log({webhook});

    if (!['memberships', 'messages'].includes(webhook.resource))
      return $.flow.exit(`resource of ${webhook.resource} not expected`);

    if (webhook.event !== 'created')
      return $.flow.exit(`event type of ${webhook.event} not expected`);

    if (webhook.resource === 'memberships') {
      log('new membership notifiction');
      try {
        const who = await got_api_client.get(`people/${webhook.actorId}`).json();
        const where = await got_api_client.get(`rooms/${webhook.data.roomId}`).json();
        await alert(`📢 ${person_link(who)} added me to ${room_link(where)}`);
      } catch(error) {
        log({body: error.response?.body}, {error});
      }
      return $.flow.exit('our bot was added to a space');
    }

    if (/@webex\.bot$/.test(webhook.data.personEmail))
      return $.flow.exit('this is a message from another bot, ignore it');

    const message_id = webhook.data.id;

    async function respond(message) {
      log('fn respond');
      try {
        await send_message(admin_room, message, message_id);
      } catch(error) {
        // swallow error
      }
    }

    const api_error = error => `⚠️ Webex API Error\n\n\`\`\`\n${error}\n\`\`\``;

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
    
    let source_message;
    try {
      ({ html: source_message } = await got_api_client.get(`messages/${message_id}`).json());
    } catch (error) {
      await respond(api_error(error));
      return $.flow.exit('could not get source message');
    }

    const bot_id = webhook.createdBy;
    const bot_mention = new RegExp(`<(spark-mention).+${bot_id}.+\\/\\1>`, 'g');

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
        ['/reach',  'Displays a count of all spaces and all people who I can reach']
      ].map(command => `* \`${command[0]}\` - ${command[1]}`).join('\n');

      await respond(`🤖 These are the commands I know:\n${commands}`);
      return $.flow.exit('/help command complete');
    }

    if (/^\/(rooms|spaces)/.test(source_message)) {
      log('/rooms command')
      let rooms = await room_list();
      await respond(`🚪 These are all of the rooms I am in:\n${rooms.map(room => `* ${room.title}`).join('\n')}`);
      return $.flow.exit('/rooms command complete');
    }

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

      people = [...new Set(people)];
      
      await respond(`📈 I have a reach of **${people.length} people**, across **${rooms.length} rooms**.`);
      return $.flow.exit('/reach command complete');
    }

    const word_count = source_message.split(' ').length;
    if (word_count < 10) {
      await respond(`👎🏻 Word count is little low at ${word_count} words, to be blast around to a bunch of spaces`);
      return $.flow.exit('Word count too low');
    }

    await respond('👍🏻 I received your message and I am processing it now.');

    const files = webhook.data.files ?? [];
    let file_name = '', file_path = '', file_url = '';

    if (files.length > 1) {
      await respond('💾 Webex API only supports **1** file attachment.');
      return $.flow.exit('Too many file attachments to continue');
    }
    
    if (files.length === 1) {
      try {
        const { headers } = await got_file_client.head(files[0]);
        const { 'content-length': file_size } = headers;
        log({file_size});

        if (file_size > 104857600)
          throw('HTTPError 500 - Maximum upload size of 100MB exceeded');

        if (file_size > 52428800)
          await respond('☣️ Malware scanning can take a while on larger files');

        ({ 'content-disposition': file_name } = headers);
      } catch(error) {
        await respond(api_error(error));
        return $.flow.exit('Failed to get file attachment meta data');
      }

      file_name = file_name.match(/filename="(.+)"/)[1];
      log({file_name});
      file_path = `/tmp/${file_name}`;
      file_url = files[0];

      const download_and_save = promisify(stream.pipeline);

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

    let rooms = await room_list(), successes = [], failures = [];
    log(`begin posting to ${rooms.length} rooms`);
    for (const room of rooms) {
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

    const success_status_report = `${successes.length} of ${rooms.length} Rooms\n\n`;

    if (successes.length === 0) successes.push('None');
    successes = successes.map(room => `* ${room === 'None' ? room : room_link(room)}`);

    if (failures.length === 0) failures.push('None');
    failures = failures.map(room => `* ${room === 'None' ? room : room_link(room)}`);
    
    await respond(
      `${rating} Your post was sent to ` +
      success_status_report +

      'Failures\n' +
      failures.join('\n') +

      '\n\n' +

      'Successes\n' +
      successes.join('\n')
    );
    
    if (files.length === 1) await fs.promises.unlink(file_path);

    return $.flow.exit('Finished')
  },
});
