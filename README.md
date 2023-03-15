# Personal Webex Announcement Bot

## 1. Create a Free Pipe Dream Account
Sign up for a free account at the below site.

https://pipedream.com/auth/signup

## 2. Create a Webex Bot
Login to the Webex Developer site, and create a bot using the following settings.

https://developer.webex.com/my-apps

|       Setting       |                Example Value                 |
|---------------------|----------------------------------------------|
| Bot name            | Anthony Announces                            |
| Bot username        | anthonyannounces                             |
| Icon                | Upload custom or choose a default one        |
| App Hub Description | Anthony Holloway’s Personal Announcement Bot |

Store Your Bot Token in Pipe Dream
After you create your bot, copy the access token, and then login to pipedream.com, and goto:

Settings > Environment Variables > New Environment Variable

Note: The Name value must match exactly, as the code will look for it by this name

Setting	Value
Name	ANNOUNCE_BOT_TOKEN
Value	paste your bot token in this field

Create Your Administrative Webex Space
The way you will create messages for the bot to send out, is by creating a special administrative space, and sending messages to your bot.  Only people inside this space, who mention the bot by name, will cause the bot to distribute messages around. Be careful who you let in, but you must at least have yourself and your bot in this space before you continue with this guide.

Get Admin Space Room ID and Store it in Pipe Dream
Login to the Webex Developer site, and get a listing of all rooms your bot is in.

TIP: You will need to swap over to your Bot’s access token, otherwise, this will list all of your own space,s instead of all of your Bot’s spaces.

https://developer.webex.com/docs/api/v1/rooms/list-rooms

After you get your Admin room ID, copy the room ID, and then login to pipedream.com, and goto:

Settings > Environment Variables > New Environment Variable

Note: The Name value must match exactly, as the code will look for it by this name

Setting	Value
Name	ANNOUNCE_ADMIN_ROOM
Value	paste your admin room ID in this field

Create a Pipe Dream Workflow
Login to pipdream.com and goto:

Workflows > New > New HTTP / Webhook Requests

Rename this new workflow from Untitled Workflow to something useful that you like (e.g., My Announcement Bot), then press:

Save and continue

Copy and paste the unique URL given, to trigger your workflow below, for later reference.

E.g., https://eo6em5eqeip1uls.m.pipedream.net

Click the small white plus sign in the small grey box to add a new step, and select:

Run custom code

Copy and paste the below code from github, into the code editor in pipedream, replacing all of the existing content which showed up in pipedream by default.

https://github.com/avholloway/wbx-ann-bot/blob/edc4567a394492b0f84c76611058c37ba1235b11/bot-code-v2.js

To finish, click on:

Deploy

Now you will need to adjust the timeout for your workflow to 300 seconds in the following place:

Workflows > [the workflow for your bot] > Settings > Execution Controls > Timeout
Create a Webhook for Messages to Your Bot
Login to the Webex Developer site, and create a webhook using the following settings.

TIP: You will need to swap over to your Bot’s access token, otherwise, this will create the webhook for you and not for your bot.

https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook

Setting	Value
name	New Messages
targetUrl	paste your pipedream url in this field
resource	messages
event	created
filter	mentionedPeople=me&roomId=paste your admin room id on the end

Example filter:
mentionedPeople=me&roomId= Y2lzY29zcGFyazovL3VzL1JPT00vYzc3YWIyNDAtYjkyYy0xMWVkLTg2NTItMDdmMTM2ZTJhNzdk
Create a Webhook to Know When Your Bot is Added to a Room
Login to the Webex Developer site, and create a webhook using the following settings.

TIP: You will need to swap over to your Bot’s access token, otherwise, this will create the webhook for you and not for your bot.

https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook

Setting	Value
name	New Membership
targetUrl	paste your pipedream url in this field
resource	memberships
event	created
filter	personEmail=paste your bot’s email address here

Bot Email Addresses:
These are just your bot’s username followed by “@webex.bot”

Example filter:
personEmail=anthonyannounces@webex.bot
Take Your Bot for a Test Drive
Create a test space with you, the bot, and anyone else who you’d like to test with, and notice in the Admin space you are alerted to this new membership.

 

Inside of your Admin space, mention the bot by name, and then type out your test message and send it.

Example:

My message to the bot
 

The bot’s message to the test space
 

The bot’s acknowledgement and response to me back in the admin space
 
Limitations
File Attachments
File attachments are currently supported; however, the Webex API limits us to 1 attachment only, and a maximum upload size of 100MB.  It might be a better option to just send a link to the file instead, but it’s up to you.
Maximum Spaces
This is a low scale, low volume solution, hence the free account on pipedream.com.  Presently, if you add the bot to more than 100 spaces, the bot will not only be slow, due to how many spaces it has to message, but only a random set of 100 spaces from the total spaces list will be used.  If you need truly large scale mass messaging, this is not the solution for you.
Free Pipedream Account
The free account let’s you post quite a bit, but there are limits.  Note that the limits specified really do not apply to how many spaces you can send to, rather, it’s how many messages you send to your bot.  If you feel like you need more, you can always pay for more: https://pipedream.com/pricing
Upgrading From Announcement Bot v1
If you have previous built and deployed my announcement bot based on v1 instructions, then here are the changes you will need to make, in order to realize the benefits (file attachment support, detailed status report, and bot was added to a space notifications) of announcement bot v2, without having to start over.  Of course, you could always start over, or just own two bots, that’s cool too.

Update the Code
Take the following github code, and paste it into your workflow, replacing all existing code.

https://github.com/avholloway/wbx-ann-bot/blob/edc4567a394492b0f84c76611058c37ba1235b11/bot-code-v2.js


And add in your Admin Room ID to the top of the code, like so:

 

Workflow Timeout
In pipedream, change the timeout to 300 seconds in the following location:

Workflows > [the workflow for your bot] > Settings > Execution Controls > Timeout

Bot Membership Webhook
So that our bot can notify us in the Admin space, whenever it’s added to another space, we need a webhook to trigger membership changes to the bot.

Login to the Webex Developer site, and create a webhook using the following settings.

TIP: You will need to swap over to your Bot’s access token, otherwise, this will create the webhook for you and not for your bot.

https://developer.webex.com/docs/api/v1/webhooks/create-a-webhook

Setting	Value
name	New Membership
targetUrl	paste your pipedream url in this field
resource	memberships
event	created
filter	personEmail=paste your bot’s email address here

Bot Email Addresses:
These are just your bot’s username followed by “@webex.bot”

Example filter:
personEmail=anthonyannounces@webex.bot

![image](https://user-images.githubusercontent.com/19751673/225369438-6e7cc38b-8e9f-4426-a829-67ea50af37a9.png)
