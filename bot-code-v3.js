import fs from 'fs';
import got from 'got';
import stream from 'stream';
import FormData from 'form-data';
import { promisify } from 'util';
import { NodeHtmlMarkdown } from 'node-html-markdown';

export default defineComponent({
  async run({ steps, $ }) {

    const webex_api_options = {
      prefixUrl: 'https://webexapis.com/v1',
      headers: {
        'Authorization': `Bearer ${process.env.ANNOUNCE_BOT_TOKEN}`
      },
      timeout: { request: 5000 },
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
      try {
        await got_api_client.post('messages', {json: {
          roomId: room,
          markdown: message,
          ...(parent && { parentId: parent })
        }});
        return true;
      } catch(error) {
        return false;
      }
    }

    async function alert(message) {
      try {
        await send_message(process.env.ANNOUNCE_ADMIN_ROOM, message);
      } catch(error) {
        // swallow error
      }
    }

    const webhook = steps.trigger.event.body;

    if (webhook.resource === 'memberships') {
      try {
        const who = await got_api_client.get(`people/${webhook.actorId}`).json();
        const where = await got_api_client.get(`rooms/${webhook.data.roomId}`).json();
        await alert(`📢 I was added to **${where.title}** by **${who.displayName} (${who.userName})**`);
      } catch(error) {
        // swallow the error
      }
      return $.flow.exit('our bot was added to a space');
    }

    if (webhook.resource !== 'messages')
      return $.flow.exit('this is not a webhook we were expecting, ignore it');

    if (/@webex\.bot$/.test(webhook.data.personEmail))
      return $.flow.exit('this is a message from another bot, ignore it');

    const admin_room = process.env.ANNOUNCE_ADMIN_ROOM;
    const message_id = webhook.data.id;

    async function respond(message) {
      try {
        await send_message(admin_room, message, message_id);
      } catch(error) {
        // swallow error
      }
    }

    const api_error = error => `⚠️ Webex API Error\n\n\`\`\`\n${error}\n\`\`\``;

    async function room_list() {
      let items;

      try {
        ({ items } = await got_api_client.get('rooms?type=group').json());
      } catch (error) {
        await respond(api_error(error));
        return $.flow.exit('could not get room list');
      }

      return items.filter(item => item.id !== admin_room);
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
    source_message = source_message.replace(bot_mention, '');
    source_message = NodeHtmlMarkdown.translate(source_message);
    source_message = source_message.trim();

    if (/^\/help/.test(source_message)) {
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
      let rooms = await room_list();
      await respond(`🚪 These are all of the rooms I am in:\n${rooms.map(room => `* ${room.title}`).join('\n')}`);
      return $.flow.exit('/rooms command complete');
    }

    if (/^\/reach/.test(source_message)) {
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
      await respond('👎🏻 Word count is little low to be blast around to a bunch of spaces');
      return $.flow.exit('Word count too low');
    }

    await respond('👍🏻 I received your message and I am processing it now.');

    const files = webhook.data.files ?? [];
    let file_name, file_path, file_url;

    if (files.length > 1) {
      await respond('💾 Webex API only supports **1** file attachment.');
      return $.flow.exit('Too many file attachments to continue');
    }
    
    if (files.length === 1) {
      try {
        const { headers } = await got_file_client.head(files[0]);
        const { 'content-length': file_size } = headers;

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
      file_path = `/tmp/${file_name}`;
      file_url = files[0]

      const download_and_save = promisify(stream.pipeline);

      while (true) {
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
    for (const room of rooms) {
      const form_data = new FormData();

      form_data.append('roomId', room.id);
      form_data.append('markdown', source_message);

      if (files.length === 1)
        form_data.append('files', fs.createReadStream(file_path));

      try {
        await got_api_client.post('messages', { body: form_data });
        successes.push(room.title);
      } catch (error) {
        failures.push(room.title);
      }
    }

    const success_status_report = `${successes.length} of ${rooms.length} Rooms\n\n`;

    if (successes.length === 0) successes.push('None');
    successes = successes.map(room => `* ${room}`);

    if (failures.length === 0) failures.push('None');
    failures = failures.map(room => `* ${room}`);

    let rating;
    const success_ratio = successes.length / rooms.length;
    if (success_ratio === 1) {
      rating = '🥳';
    } else if (success_ratio >= .90) {
      rating = '😎';
    } else if (success_ratio >= .70) {
      rating = '🤔';
    } else if (success_ratio >= .50) {
      rating = '🤨';
    } else {
      rating = '🤬';
    }
    
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
