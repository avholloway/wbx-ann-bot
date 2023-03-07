import got from "got";
import { NodeHtmlMarkdown } from 'node-html-markdown';

export default defineComponent({
  async run({ steps, $ }) {

    if (/@webex.bot$/.test(steps.trigger.event.body.data.personEmail)) {
      return $.flow.exit('We do not honor messages from other bot accounts.');
    }

    const admin_room = steps.trigger.event.body.data.roomId;
    const message_id = steps.trigger.event.body.data.id;

    const got_options = {
      prefixUrl: 'https://webexapis.com/v1',
      headers: {
        'Authorization': `Bearer ${process.env.ANNOUNCE_BOT_TOKEN}`
      },
      timeout: {
        send: 3000
      },
    };

    const got_client = got.extend(got_options);

    const send_message = (room_id, message, parent_id = undefined) => {
      const json = {
        roomId: room_id,
        markdown: message,
        ...(parent_id && { parentId: parent_id })
      };

      try {
        return got_client.post('messages', {json});
      } catch (error) {
        return Promise.resolve();
      }
    }

    await send_message(admin_room, '👍🏻 I\'m on it!', message_id);

    let source_message;
    try {
      const { html } = await got_client.get(`messages/${message_id}`).json();
      source_message = html;
    } catch (error) {
      await send_message(admin_room, '⚠️ Encountered a Webex API failure', message_id);
      return $.flow.exit(`could not get src msg - got error: ${error.response}`);
    }

    const bot_id = steps.trigger.event.body.createdBy;
    const bot_mention = new RegExp(`<(spark-mention).+${bot_id}.+\\/\\1>`);
    source_message = source_message.replace(bot_mention, '');
    source_message = NodeHtmlMarkdown.translate(source_message);
    source_message = source_message.trim();

    let rooms;
    try {
      const { items } = await got_client.get('rooms?type=group').json();
      rooms = items.filter(item => item.id !== admin_room);
    } catch (error) {
      await send_message(admin_room, '⚠️ Encountered a Webex API failure', message_id);
      return $.flow.exit(`could not get room list - got error: ${error.response}`);
    }

    for (const room of rooms) {
      await send_message(room.id, source_message);
    }

    await send_message(admin_room, `✅ All done! Your post was sent to ${rooms.length} rooms.`, message_id);

    return steps.trigger.event
  },
})
