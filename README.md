# Personal Webex Announcement Bot

## Create a Free Pipe Dream Account
Sign up for a free account at the below site.

https://pipedream.com/auth/signup

## Create a Webex Bot
Login to the Webex Developer site, and create a bot using the following settings.

https://developer.webex.com/my-apps

|       Setting       |                Example Value                 |
|---------------------|----------------------------------------------|
| Bot name            | Anthony Announces                            |
| Bot username        | anthonyannounces                             |
| Icon                | Upload custom or choose a default one        |
| App Hub Description | Anthony Holloway’s Personal Announcement Bot |

## Store Your Bot Token in Pipe Dream
After you create your bot, copy the access token, and then login to pipedream.com, and goto:

**Settings > Environment Variables > New Environment Variable**

_Note: The Name value must match exactly, as the code will look for it by this name_

| Setting |                Value                 |
|---------|--------------------------------------|
| Name    | ANNOUNCE_BOT_TOKEN                   |
| Value   | _paste your bot token in this field_ |

## Create Your Administrative Webex Space
The way you will create messages for the bot to send out, is by creating a special administrative space, and sending messages to your bot.
Only people inside this space, who mention the bot by name, will cause the bot to distribute messages around.
Be careful who you let in to this special space.

## Get Admin Space Room ID and Store it in Pipe Dream
Login to the Webex Developer site, and get a listing of all rooms your bot is in.

_TIP: You will need to swap over to your Bot’s access token, otherwise, this will list all of your own space,s instead of all of your Bot’s spaces._

https://developer.webex.com/docs/api/v1/rooms/list-rooms

After you get your Admin room ID, copy the room ID, and then login to pipedream.com, and goto:

**Settings > Environment Variables > New Environment Variable**

_Note: The Name value must match exactly, as the code will look for it by this name_

| Setting |                  Value                   |
|---------|------------------------------------------|
| Name    | ANNOUNCE_ADMIN_ROOM                      |
| Value   | _paste your admin room ID in this field_ |

## Create a Pipe Dream Workflow
Login to pipdream.com and goto:

**Workflows > New > New HTTP / Webhook Requests**

Rename this new workflow from Untitled Workflow to something useful that you like (_e.g., My Announcement Bot_), then press:

**Save and continue**

Copy and paste the unique URL given, for later reference; this is how Webex will trigger your bot.

Click the small white plus sign in the small grey box to add a new step, and select:

**Run custom code**

Copy and paste the bot code from this github repository, into the code editor in pipedream, replacing all of the default code which showed up in pipedream by default.

To finish, click on:

**Deploy**

Now you will need to adjust the timeout for your workflow to 300 seconds in the following place:

**Workflows > _the workflow you just created_ > Settings > Execution Controls > Timeout**

## Create a Webhook for Messages to Your Bot
Login to the Webex Developer site, and create a webhook using the following settings.

_TIP: You will need to swap over to your Bot’s access token, otherwise, this will create the webhook for you and not for your bot._

https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook

|  Setting  |                              Value                              |
|-----------|-----------------------------------------------------------------|
| name      | New Messages                                                    |
| targetUrl | _paste your pipedream url in this field_                        |
| resource  | messages                                                        |
| event     | created                                                         |
| filter    | mentionedPeople=me&roomId=_paste your admin room id on the end_ |

_Example filter: mentionedPeople=me&roomId=Y2lzY29zcGFyazovL3VzL1JPT00vYzc3YWIyNDAtYjkyYy0xMWVkLTg2NTItMDdmMTM2ZTJhNzdk_

## Create a Webhook to Know When Your Bot is Added to a Room
Login to the Webex Developer site, and create a webhook using the following settings.

_TIP: You will need to swap over to your Bot’s access token, otherwise, this will create the webhook for you and not for your bot._

https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook

|  Setting  |                       Value                       |
|-----------|---------------------------------------------------|
| name      | New Membership                                    |
| targetUrl | _paste your pipedream url in this field_          |
| resource  | memberships                                       |
| event     | created                                           |
| filter    | personEmail=_paste your bot’s email address here_ |

_Bot Email Address:
This are just your bot’s username followed by “@webex.bot”_

_Example filter: personEmail=anthonyannounces@webex.bot_

## Take Your Bot for a Test Drive
Create a new space with you, the bot, and optionally: anyone else who you’d like to test with, and notice in the Admin space you are alerted to this new membership.

Inside of your Admin space, mention the bot by name, and then type out your test message and send it.

_Note: The code imposes a minimum of 10 words, in order for it to announce your message to all spaces. This protects you from messing up a command to the bot, and the bot mistakenly thinking you meant to send that message to all spaces. You can adjust that value in the code if you prefer a smaller or larger word count._
 
## Limitations
### File Attachments
File attachments are currently supported; however, the Webex API limits us to 1 attachment only during a message post, and a maximum upload size of 100MB.  It might be a better option to just send a link to the file instead, but it’s up to you.
### Maximum Spaces
This is a low scale, low volume solution, hence the free account on pipedream.com.  Presently, if you add the bot to more than 100 spaces, the bot will not only be slow (especially if sending a 100MB file), due to how many spaces it has to message, but only a random set of 100 spaces from the total spaces list will be used.  If you need truly large scale mass messaging, this is not the solution for you.  Feel free to build upon what you have so far.
### Free Pipedream Account
The free account let’s you post quite a bit, but there are limits.  Note that the limits specified really do not apply to how many spaces you can send to, rather, it’s how many messages you send to your bot.  If you feel like you need more, you can always pay for more: https://pipedream.com/pricing

![image](https://user-images.githubusercontent.com/19751673/225369438-6e7cc38b-8e9f-4426-a829-67ea50af37a9.png)
