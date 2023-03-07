import fs from 'fs';
import got from 'got';
import stream from 'stream';
import FormData from 'form-data';
import { promisify } from 'util';
import { NodeHtmlMarkdown } from 'node-html-markdown';

const admin_room = 'your admin room ID here';

export default defineComponent({
  async run({ steps, $ }) {

    const log = thing => console.log('LOG:', thing);

    log('start');

    const got_common_options = {
      headers: {
        'Authorization': `Bearer ${process.env.ANNOUNCE_BOT_TOKEN}`
      },
      timeout: { request: 15000 },
      retry: {
        methods: [...got.defaults.options.retry.methods, 'POST'],
        statusCodes: [...got.defaults.options.retry.statusCodes, 423],
        maxRetryAfter: 180
      }
    };
    log({got_common_options});

    const got_options = {
      ...got_common_options,
      prefixUrl: 'https://webexapis.com/v1',
    };
    log({got_options});

    const got_client = got.extend(got_options);
    log({got_client});

    const got_file_client = got.extend(got_common_options);
    log({got_file_client});

    log('defining send_messsage');
    const send_message = async (room_id, message, parent_id = undefined) => {
      log('send_messaged: entered');
      const json = {
        roomId: room_id,
        markdown: message,
        ...(parent_id && { parentId: parent_id })
      };
      log({json});

      try {
        log('about to make http request');
        const res = await got_client.post('messages', {json});
        log('req complete');
        log({res});
        log('send_message: exiting true')
        return true;
      } catch(error) {
        log('send_message: exiting false')
        return false;
      }
    }

    const webhook = steps.trigger.event.body;
    log({webhook});

    log('checking webhook resource');
    log({resource: webhook.resource});
    if (webhook.resource === 'memberships') {
      log('it was memberships');

      log('about to make api call for who');
      const who = await got_client.get(`people/${webhook.actorId}`).json();
      log({who});

      log('about to make api call for where');
      const where = await got_client.get(`rooms/${webhook.data.roomId}`).json();
      log({where});

      await send_message(admin_room, `📢 I was added to **${where.title}** by **${who.displayName} (${who.userName})**`)

      log('exiting flow');
      return $.flow.exit('our bot was added to a space');
    }

    if (webhook.resource !== 'messages') {
      log('webhook is not a membership nor a message');
      log('exiting flow');
      return $.flow.exit('this is not a webhook we were expecting');
    }

    log('webhook is a message');

    if (/@webex.bot$/.test(webhook.data.personEmail)) {
      log('message was from a bot');
      log('exiting flow');
      return $.flow.exit('We do not honor messages from other bot accounts.');
    }

    log('message is from an admin');

    const message_id = webhook.data.id;
    log({message_id});

    const files = webhook.data.files ?? [];
    log({files});

    let file_name, file_path;

    if (files.length > 1) {
      log(`we were sent too many files @ ${files.length} files`);

      await send_message(admin_room, '💾 Webex API only supports **1** file attachment', message_id);

      log('exiting flow');
      return $.flow.exit('Too many file attachments to continue');
    }
    
    await send_message(admin_room, '👍🏻 I\'m on it!', message_id);
    
    if (files.length === 1) {
      log('dealing with exactly 1 file');
      try {
        log('about to make a file head request');
        const { headers } = await got_file_client.head(files[0]);
        log('head request complete');
        log({headers});

        const { 'content-length': file_size } = headers;
        log({file_size});

        ({ 'content-disposition': file_name } = headers);
        log({file_name});

        if (file_size >= 104857600) {
          log('file size too big; throwing exception');
          throw('HTTPError 500 - Maximum upload size of 100MB exceeded');
        }

        log('file size not too big');

      } catch(error) {
        log('error on file head request routine');
        log({error});

        await send_message(admin_room, `⚠️ Webex API Error\n\n\`\`\`\n${error}\n\`\`\``, message_id);
        
        log('exiting flow');
        return $.flow.exit('Failed to get file attachment meta data');
      }

      file_name = file_name.match(/filename="(.+)"/)[1];
      log({file_name});

      file_path = `/tmp/${file_name}`;
      log({file_path});

      const download_pipeline = promisify(stream.pipeline);
      log({download_pipeline});

      let file_downloaded = false, retry_count = 0, notify_on_malware_scanning = false;
      while (!file_downloaded && retry_count <= 20) {
        log('entering file download loop');

        try {
          log('about to download the file in a pipline');
          await download_pipeline(
            got_file_client.stream(files[0]),
            fs.createWriteStream(file_path)
          );

          log('file download complete.');
          file_downloaded = true;

        } catch (download_error) {
          log('error downloading file');
          log({download_error});
          log({statusCode: download_error.response.statusCode});

          if (download_error.response.statusCode === 423) {
            const { 'retry-after': retry_after } = download_error.response.headers;
            log(`we were told to retry after ${retry_after} seconds, we'll wait ${retry_after * 3} seconds.`);

            if (retry_count > 3 && !notify_on_malware_scanning) {
              notify_on_malware_scanning = true;
              await send_message(admin_room, '☣️ Malware scanning might take a bit...', message_id);
            }

            await new Promise(r => setTimeout(r, retry_after * 3 * 1000));
            log('ok, ready to retry');

            retry_count++;
            log({retry_count});

          } else {
            log('a non 423 lock error was received, let\'s abandon this download');
            retry_count = 999;
          }

        }
        log('bottom of file download loop; about to loop');
      }

      if (! file_downloaded) {
        log('failed to download file, exiting flow');
        return $.flow.exit('Failed to download file attachment');
      }

    }

    let source_message;
    try {
      log('about to make api call for source message');
      ({ html: source_message } = await got_client.get(`messages/${message_id}`).json());
      log('api call complete.');
      log({source_message});
    } catch (error) {
      log('error getting source message');
      log({error});

      await send_message(admin_room, `⚠️ Webex API Error\n\n\`\`\`\n${error}\n\`\`\``, message_id);

      if (files.length === 1) {
        log('cleaning up local file');
        await fs.promises.unlink(file_path);
      }

      log('exiting flow');
      return $.flow.exit('could not get src msg');
    }

    const bot_id = webhook.createdBy;
    log({bot_id});

    const bot_mention = new RegExp(`<(spark-mention).+${bot_id}.+\\/\\1>`);
    log({bot_mention});

    source_message = source_message.replace(bot_mention, '');
    log({source_message});

    source_message = NodeHtmlMarkdown.translate(source_message);
    log({source_message});

    source_message = source_message.trim();
    log({source_message});

    let items;
    try {
      log('about to make api call for room list');
      ({ items } = await got_client.get('rooms?type=group').json());
      log('api call for room list complete');
      log({items});

    } catch (error) {
      log('api call for room list failed');
      log({error});

      await send_message(admin_room, `⚠️ Webex API Error\n\n\`\`\`\n${error}\n\`\`\``, message_id);

      if (files.length === 1) {
        log('cleaning up local file');
        await fs.promises.unlink(file_path);
      }

      log('exiting flow');
      return $.flow.exit('could not get room list');
    }

    const rooms = items.filter(item => item.id !== admin_room);
    log('rooms filterd');
    log({rooms});

    const results = [];

    log('begin room iteration');
    for (const room of rooms) {
      log(`current iteration: ${room.title}`);

      if (files.length === 0) {
        log('about to make api call to post a message');
        const result = await send_message(room.id, source_message);
        log('api call complete');

        results.push({title: room.title, success: result});
        log({results});
      } else {
        const form_data = new FormData();
        form_data.append('roomId', room.id);
        form_data.append('markdown', `${source_message}\n\n_Attachment: ${file_name}_`);
        form_data.append('files', fs.createReadStream(file_path));
        log({form_data});

        try {
          log('about to make api call to post a message');
          const res = await got_client.post('messages', { body: form_data });
          log('api call to post message complete');

          results.push({title: room.title, success: true});
          log({results});

        } catch (error) {
          log('api call to post message failed');
          log({error});

          results.push({title: room.title, success: false});
          log({results});
        }
      }
    }

    if (files.length === 1) {
      log('cleaning up local file');
      await fs.promises.unlink(file_path);
    }

    const successes = results.filter(result => result.success).map(room => `* ${room.title}`);
    if (successes.length === 0) successes[0] = '* None';
    log({successes});

    const failures = results.filter(result => !result.success).map(room => `* ${room.title}`);
    if (failures.length === 0) failures[0] = '* None';
    log({failures});

    await send_message(
      admin_room,

      '### ✅ Your post was sent to ' +
      `${successes.length} of ${rooms.length} Rooms\n\n` +

      '#### Failures\n' +
      failures.join('\n') +

      '\n' +

      '#### Successes\n' +
      successes.join('\n'),

      message_id
    );

    log('done!');
    return steps.trigger.event
  },
});
