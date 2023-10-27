import { MatrixClient, SimpleFsStorageProvider, AutojoinRoomsMixin, RustSdkCryptoStorageProvider } from 'matrix-bot-sdk';
import { emojify } from 'node-emoji';
import { catbotReacts } from './modules/catbotReacts';
import { checkActionWords, getAbout, helpConstructor } from './helpers';
import { wttr } from './modules/weather';
import { lastlaunchtime } from './main';
import addStats, { getStats } from './modules/stats';
import { intAddStatsModuleType } from './modules/stats/interfaces';
import { Nullable } from './interfaces';

const storage = new SimpleFsStorageProvider("catbot.json");

let client: any

export async function matrix(homeserverUrl: string, accessToken: string) {
    const cryptoProvider = new RustSdkCryptoStorageProvider("./crypt");
    client = new MatrixClient(homeserverUrl, accessToken, storage, cryptoProvider);
    AutojoinRoomsMixin.setupOnClient(client);
    const catSelf = await client.getUserId()
    const catSelfData = await client.getUserProfile(catSelf)

    client.on("room.message", processEvents);
    client.start().then(() => console.log("meow! catBot started!"));

    async function processEvents(roomId: string, event: any) {
        const body = event['content']['body'];
        const eId = event.event_id
        const mentions = (event.content['m.mentions']?.user_ids) ? event.content['m.mentions'].user_ids : ['none']
        
        // Log all messages processed
        // const sender = event.sender
        // const timeS = new Date(event.origin_server_ts).toLocaleString()
        // console.log(timeS + ' - ' + sender + ': ' + body);
        
        // Don't handle unhelpful events (ones that aren't text messages, are redacted, or sent by us)
        if (event['sender'] === catSelf) return;
        if (event['content']?.['msgtype'] !== 'm.text') return;
        addStats('totalProcessedMsgs', roomId)

        // CATBOT REACTS
        catbotReacts(roomId, body, eId, mentions, catSelf, catSelfData.displayname)

        // CATBOT RESPONDS
        // const response = await catbotResponds(body, eId)
        // console.log(response);

        // TRIGGERED INTEGRATIONS
        // send commands with either '!meow' or a mention or in a room with only bot (last one needed for android which doesn't seem to include mentions)
        const roomMembers: [] = await client.getJoinedRoomMembers(roomId);
        const numberRoomMembers: number = roomMembers.length;
        const fbody = event['content']['formatted_body'];
        if (body?.startsWith('!meow') || mentions.includes(catSelf) || numberRoomMembers == 2 || fbody?.includes('https://matrix.to/#/' + catSelf)) {

            // NIGHTSCOUT INTEGRATION
            if (process.env.NIGHTSCOUT) {
                import('./modules/nightscout')
                    .then(ns => {
                        ns.nightscout(roomId, body)
                    })
            }

            // WEATHER
            wttr(roomId, body)

            // ADMIN COMMANDS
            universalCommands(roomId, body)
        }

        // Put in functions that run randomly on messages under here
        if (Math.random() <= 0.01) {
            addStats('totalProcessedMsgs',roomId,'randomFunctions')
            if (Math.random() <= 0.01) {
                await client.replyNotice(roomId, event, 'Meow! It\'s me CatBot!', 'Meow! It\'s me CatBot! 🐱🤖');
                addStats('msgAction',roomId,'randomFunctions')
            }
        }
    }
}

export async function sendMsg(roomId: string, text: string, replyEvent?: any, customMeow?: Nullable<string>, module?: typeof intAddStatsModuleType[keyof typeof intAddStatsModuleType]) {
    if (customMeow) {
        text = customMeow + text
    } else if (customMeow === null || customMeow === undefined) {
        text = emojify(':cat:') + ' meow! ' + text
    }
    if (!replyEvent) {
        client.sendHtmlNotice(roomId, text)
        addStats('totalActivity',roomId,module,'sendMsg')
    } else {
        client.replyHtmlNotice(roomId, replyEvent, text.replace(/<[^>]+>/g, ''), text)
        addStats('totalActivity',roomId,module,'sendReply')
    }
}

export async function sendEmote(roomId: string, eventId: string, emote: string, module: typeof intAddStatsModuleType[keyof typeof intAddStatsModuleType]) {
    try {
        await client.sendRawEvent(roomId, 'm.reaction', { 'm.relates_to': { event_id: eventId, key: emote, rel_type: 'm.annotation' } })
        addStats('totalActivity',roomId,module,'sendEmote')
    } catch (err) {
        console.error({ details: { roomId: roomId, eventId: eventId, emote: emote } }, err);
    }
}

async function universalCommands(roomId: string, body: any) {
    const actions = [
        {
            name: 'about',
            triggers: [/\babout\b/i],
            effect: 'Find out about catBot'
        },
        {
            name: 'help',
            triggers: [/\bhelp\b/],
            effect: 'This help message'
        },
        {
            name: 'stats',
            triggers: [/\bstats\b/i,],
            effect: 'Get catBot stats'
        },
        {
            name: 'uptime',
            triggers: [/\buptime\b/i,],
            effect: 'Get catBot uptime'
        },
        {
            name: 'version',
            triggers: [/\bversion\b/i,],
            effect: 'Get catBot version number'
        },
    ]
    const active: any = await checkActionWords(actions, body) || { active: false, action: 'none', actions: [] }
    if (active) {
        addStats('totalProcessedMsgs', roomId, 'adminFunctions')
        if (active.action == 'help') {
            const moduleName = 'Admin Functions'
            const moduleDesc = 'General Built in functions'
            helpConstructor(roomId, actions, moduleName, moduleDesc)
        } else if (active.action == 'about') {
            const res = await getAbout()
            await sendMsg(roomId, 'Let me tell you about <b>' + res.name + '</b>! <br>' + res.description + ' by <b>' + res.author + '</b><br> Version is <b>' + res.version + '</b><br>Licensed under ' + res.license,null,null,'adminFunctions')
            addStats('msgAction', roomId, 'adminFunctions')
        } else if (active.action == 'stats') {
            const res = await getStats()
            await sendMsg(roomId, '<h4>Here are some<b> catStats!</b></h4><ul><li>I\'ve read <b>' + res.totalProcessedMsgs + '</b> message over <b>' + res.conversationsEvesdropped + '</b> conversations I have evesdropped on.</li><li>I\'ve sent <b>' + res.msgsSent + ' </b> messages and <b>' + res.emotesSent +' </b> emotes.</li><li><b>' + res.weatherReportsSent + '</b> times I\'ve told you the weather.</li><li>I\'ve restarted <b>' + res.timesRestarted +' </b> times and checked on sugar levels <b>' + res.sugarSent + '</b> times.</li><li> You have asked me for kitty help on <b>' + res.timesKittyHelped + '</b> occassions.</li></ul>',null,null,'adminFunctions')
            addStats('msgAction', roomId, 'adminFunctions')
        } else if (active.action == 'uptime') {
            const res = lastlaunchtime
            const now = new Date()
            const hours = ((now.getHours() - res.getHours()) > 9) ? Math.abs(now.getHours() - res.getHours()) : '0' + Math.abs(now.getHours() - res.getHours()).toString()
            const mins = ((now.getMinutes() - res.getMinutes()) > 9) ? Math.abs(now.getMinutes() - res.getMinutes()) : '0' + Math.abs(now.getMinutes() - res.getMinutes()).toString()
            const secs = ((now.getSeconds() - res.getSeconds()) > 9) ? Math.abs(now.getSeconds() - res.getSeconds()) : '0' + Math.abs(now.getSeconds() - res.getSeconds()).toString()
            const days = ((now.getDate() - res.getDate()) > 0) ? Math.abs(now.getDate() - res.getDate()) + ' days ' : ''
            const months = ((now.getMonth() - res.getMonth()) > 0) ? Math.abs(now.getMonth() - res.getMonth()) + ' months ' : ''
            const years = ((now.getFullYear() - res.getFullYear()) > 0) ? Math.abs(now.getFullYear() - res.getFullYear()) + ' years ' : ''
            const timeAgo = years + months + days + hours + ':' + mins + ':' + secs
            await sendMsg(roomId, '<br>Running since: <b>' + res.toLocaleString('en-NZ') + '</b> <br> Uptime: <b>' + timeAgo + '</b>',null,null,'adminFunctions')
            addStats('msgAction', roomId, 'adminFunctions')
        } else if (active.action == 'version') {
            const res = await getAbout()
            await sendMsg(roomId, '<b>' + res.name + '</b> version is <b>' + res.version + '</b>',null,null,'adminFunctions')
            addStats('msgAction', roomId, 'adminFunctions')
        }
    }
}

export async function getRoomMembers(roomId: string) {
    const members = await client.getJoinedRoomMembers(roomId);
    const count = members.length
    return { members: members, count: count}
}

export default {
    matrix,
    sendEmote,
    sendMsg,
    getRoomMembers,
}