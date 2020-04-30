// Include dependencies
require('dotenv').config()
const { Chess } = require('chess.js')
const nexmo = require('nexmo')
const express = require('express')
const bodyParser = require('body-parser')
const nedb = require('nedb-promises')
const shortid = require('shortid');

// Configure Express application
const app = express()
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

// Initialize database
const Games = nedb.create('games.db')
Games.load()

// Initialise Nexmo client
const client = new nexmo({
  apiKey: process.env.NEXMO_KEY,
  apiSecret: process.env.NEXMO_SECRET,
  applicationId: process.env.NEXMO_APP_ID,
  privateKey: process.env.NEXMO_PRIVATE_KEY
})

const sendMessage = async (recipient, content, type = 'text') => {
  return new Promise((resolve, reject) => {
    try {
      const to = { type: 'messenger', id: recipient }
      const from = { type: 'messenger', id: process.env.NEXMO_FACEBOOK_PAGE_ID }
      let message = { content: {} };
      if(type == 'text') message.content = { type: 'text', text: content }
      if(type == 'image') message.content = { type: 'image', image: { url: content } }
      client.channel.send(to, from, message, (err, res) => {
      if (err) return reject(err)
        resolve(res.message_uuid)
      })
    } catch(err) {
      reject(err)
    }
  })
}

const getGame = async (type, identifier) => {
    return new Promise(async (resolve, reject) => {
        try {
            const games = await Games.find()
            let game = games.find(game => {
                if(type == 'uuid') {
                    const { black, white } = game.players
                    return game.active == true && (black.uuid == identifier || white.uuid == identifier)
                }
                if(type == 'code') {
                    return game.active == true && game.code == identifier
                }
            })
            resolve(game)
        } catch(e) {
            reject(e)
        }
    })
}

const createGame = async (uuid) => {
    return new Promise(async (resolve, reject) => {
        try {
            if(await getGame('uuid', uuid)) {
                await sendMessage(uuid, 'If you want to start a new game, you must leave your existing game, reply with "leave".')
            } else {
                const chess = new Chess()
                const game = await Games.insert({
                    active: true,
                    fen: chess.fen(), 
                    code: shortid.generate(),
                    players: { black: { uuid, timer: 3600, lastMove: {} }, white: { timer: 3600, lastMove: {} } }
                })
                await sendMessage(uuid, `You're registered, but still need someone to play against. Ask a friend to send a message to this page with the message "join ${game.code}" to play against them.`)
            }
            resolve()
        } catch(e) {
            reject(e)
        }
    })
}

const joinGame = async (uuid, code) => {
    return new Promise(async (resolve, reject) => {
        try {
            const game = await getGame('code', code)
            if(!game) {
                await sendMessage(uuid, "That isn't a valid game code, sorry.")
                resolve()
            } else {
                if(game && !game.players.white.uuid) {
                    await Games.update({ _id: game._id }, { $set: { 'players.white.uuid': uuid } })
                    await startGame(code)
                    resolve()
                } else {
                    await sendMessage(uuid, 'This game already has two players. Are you sure you typed the game code correctly?')
                    resolve()
                }
            }
        } catch(e) {
            reject(e)
        }
    })
}

const leaveGame = async (uuid) => {
    return new Promise(async (resolve, reject) => {
        try {
            const game = await getGame('uuid', uuid)
            if(game) {
                const { black, white } = game.players
                await Games.update({ _id: game._id }, { $set: { active: false } })
                await sendMessage(black.uuid, 'Game has been ended.')
                if(white.uuid) {
                    await sendMessage(white.uuid, 'Game has been ended.')
                }
                resolve()
            } else {
                await sendMessage(uuid, 'You are not in a game.')
                resolve()
            }
        } catch(e) {
            reject(e)
        }
    })
}

const sendBoard = async (uuid, fen) => {
    return new Promise(async (resolve, reject) => {
        try {
            const url = `http://www.fen-to-image.com/image/36/single/coords/${fen.split(" ")[0]}`
            const message = await sendMessage(uuid, url, 'image')
            resolve(message)
        } catch(e) {
            reject(e)
        }
    })
}

const startGame = async (code) => {
    return new Promise(async (resolve, reject) => {
        try {
            const game = await getGame('code', code)
            const chess = new Chess(game.fen)
            const turn = chess.turn()
            const { white, black } = game.players
            const coreInstructions = 'You have 60 minutes to play your turns, which counts down between the time you read a board and when you respond with a valid move. To move during your turn, send us a message which reads "move old_space to new_space", for example "move a2 to a4". If you want to leave this game and end it early, just send "leave".'
            const yourTurnMessage = 'The game has started and you are the starting player.'
            const yourOpponentStartsMessage = 'The game has started and your opponent is the starting player.'
            if(turn == 'w') {
                await sendMessage(white.uuid, `${yourTurnMessage}\n\nYou are playing white.\n\n${coreInstructions}`)
                const message = await sendBoard(white.uuid, game.fen)
                await Games.update({ _id: game._id }, { $set: { 'players.white.lastMove.messageId': message } })

                await sendMessage(black.uuid, `${yourOpponentStartsMessage}\n\nYou are playing black.\n\n${coreInstructions}`)
            } else {
                await sendMessage(black.uuid, `${yourTurnMessage}\n\nYou are playing black.\n\n${coreInstructions}`)
                const message = await sendBoard(black.uuid, game.fen)
                await Games.update({ _id: game._id }, { $set: { 'players.black.lastMove.messageId': message } })

                await sendMessage(white.uuid, `${yourOpponentStartsMessage}\n\nYou are playing white.\n\n${coreInstructions}`)
            }
            resolve()
        } catch(e) {
            reject(e)
        }
    })
}

const makeMove = async (uuid, instruction, timestamp) => {
    return new Promise(async (resolve, reject) => {
        try {
            const p = instruction.split(" ")
            const correctLength = p[0].length == 2 && p[2].length == 2

            const game = await getGame('uuid', uuid)
            const chess = new Chess(game.fen)
            const turn = chess.turn()
            const move = chess.move({ from: p[0], to: p[2] })

            const { black, white } = game.players
            let color;
            if(white.uuid == uuid) color = { s: 'w', f: 'white' }
            if(black.uuid == uuid) color = { s: 'b', f: 'black' }

            if(!correctLength) {
                await sendMessage(uuid, 'Your message is not in the correct format. Please try `move old_space to new_space`, for example "move b1 to b3"')
                return resolve()
            }
            if(!game) {
                await sendMessage(uuid, 'You are not in a game at the moment.')
                return resolve()
            }
            if(color.s != turn) {
                await sendMessage(uuid, 'It is not your turn. Wait for your opponent to make their move.')
                return resolve()
            }
            if(!move) {
                await sendMessage(uuid, 'Not a valid move.')
                return resolve()
            }

            const read = game.players[color.f].lastMove.seenBoard;
            const played = timestamp;
            const secsUsed = parseInt(Math.abs((new Date(played).getTime() - new Date(read).getTime()) / 1000))
            const secsBeforePlay = game.players[color.f].timer;
            const secsAfterPlay = secsBeforePlay - secsUsed;

            if(chess.game_over()) {
                await Games.update({ _id: game._id }, { $set: { active: false }})
                await sendMessage(white.uuid, 'Game is over. Thanks for playing.')
                await sendMessage(black.uuid, 'Game is over. Thanks for playing.')
            } else if (secsAfterPlay < 0) {
                await Games.update({ _id: game._id }, { $set: { active: false }})
                await sendMessage(white.uuid, `Game is over because ${color.f} ran out of time.`)
                await sendMessage(black.uuid, `Game is over because ${color.f} ran out of time.`)
            } else {
                if(color.f == 'white') {
                    await Games.update( { _id: game._id }, { $set: { fen: chess.fen(), 'players.white.timer': secsAfterPlay }} )
                    await sendMessage(white.uuid, `Move accepted and it's now black's turn. It took you ${secsUsed} seconds, which means you have ${Math.floor(white.timer/60) > 0 ? Math.floor(white.timer/60) + ' minutes' : white.timer + ' seconds' } left from when your turn begins.`)
                    await sendMessage(black.uuid, `It is now your turn. Reply with "move old_space to new_space" to play, for example "move a2 to a4". You have ${Math.floor(black.timer/60) > 0 ? Math.floor(black.timer/60) + ' minutes' : black.timer + ' seconds' } remaining, which pauses once you've sent a valid move.`)
                    const message = await sendBoard(black.uuid, chess.fen())
                    await Games.update({ _id: game._id }, { $set: { 'players.black.lastMove.messageId': message } })
                } else {
                    await Games.update( { _id: game._id }, { $set: { fen: chess.fen(), 'players.black.timer': secsAfterPlay }} )
                    await sendMessage(black.uuid, `Move accepted and it's now white's turn. It took you ${secsUsed} seconds, which means you have ${Math.floor(black.timer/60) > 0 ? Math.floor(black.timer/60) + ' minutes' : black.timer + ' seconds' } left from when your turn begins.`)
                    await sendMessage(white.uuid, `It is now your turn. Reply with "move old_space to new_space" to play, for example "move a2 to a4". You have ${Math.floor(white.timer/60) > 0 ? Math.floor(white.timer/60) + ' minutes' : white.timer + ' seconds' } remaining, which pauses once you've sent a valid move.`)
                    const message = await sendBoard(white.uuid, chess.fen())
                    await Games.update({ _id: game._id }, { $set: { 'players.white.lastMove.messageId': message } })
                }
            }
            resolve()
        } catch(e) {
            reject(e)
        }
    })
}

const defaultMessage = async (uuid) => {
    return new Promise(async (resolve, reject) => {
        try {
            const game = await getGame('uuid', uuid)
            if(game) {
                await sendMessage(uuid, 'Valid commands:\n\nmove old_space to new_space: moves piece\nleave: leaves your current game\nboard: sends the current board')
                resolve()
            } else {
                await sendMessage(uuid, 'Valid commands:\n\nstart: creates new game\njoin <code>: joins existing game\nboard: sends the current board')
            }
            resolve()
        } catch(e) {
            reject(e)
        }
    })
}

const stripFirstWord = (string) => {
    let stringArray = string.split(" ")
    stringArray.shift()
    return stringArray.join(" ")
}

app.post('/inbound', async (req, res) => {
    try {
        const { timestamp, from: { id: uuid }, message: { content: { text } } } = req.body
        const keyword = text.split(' ')[0].toLowerCase()
        const instruction = stripFirstWord(text)

        switch(keyword) {
            case 'start':
                await createGame(uuid)
                break;
            case 'join':
                await joinGame(uuid, instruction)
                break;
            case 'leave':
                await leaveGame(uuid)
                break;
            case 'move':
                await makeMove(uuid, instruction, timestamp)
                break;
            case 'board':
                const game = await getGame('uuid', uuid)
                if(game) {
                    const chess = new Chess(game.fen)
                    sendBoard(uuid, chess.fen())
                } else {
                    await sendMessage(uuid, 'You are not in a game.')
                }
                break;
            default:
                await defaultMessage(uuid)
        }
        res.status(200).end()
    } catch(e) {
        console.log(e)
        res.status(200).end()
    }
})

app.post('/status', async (req, res) => {
    try {
        const { status, message_uuid: messageId, timestamp, to: { id: uuid } } = req.body
        const game = await getGame('uuid', uuid)
        if(status == 'read' && game) {
            const { black, white } = game.players
            const playerLastMessageIds = [black.lastMove.messageId, white.lastMove.messageId]
            if(playerLastMessageIds[0] == messageId) {
                await Games.update({ _id: game._id }, { $set: { 'players.black.lastMove.seenBoard': timestamp } })
            }
            if(playerLastMessageIds[1] == messageId) {
                await Games.update({ _id: game._id }, { $set: { 'players.white.lastMove.seenBoard': timestamp } })
            }
        }
        res.status(200).end()
    } catch(e) {
        console.log(e)
        res.status(200).end()
    }
})

app.listen(3000, () => {
  console.log("Application running on port 3000");
})

String.prototype.r = function(s, r) { return  this.split(s).join(r) }