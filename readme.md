# Chessinator

A Facebook bot to play speed Chess between two players. The timer only counts down once thea new board position has been seen, and pauses once the player responds with a valid move. 

This project utilizes: 

* The Vonage Messages API
* [fen-to-image.com](http://www.fen-to-image.com/manual) (which is fine for a proof-of-concept, but should not be used in production by request of it's creator)

## Get Started

* Run `npx ngrok http 3000`
* Update your Vonage API application URLs with `YOUR_NGROK_URL/inbound` and `YOUR_NGROK_URL/status`
* Create a Facebook page, and [link it to your Vonage API account](https://messenger.nexmo.com/)
* [Create a Vonage API Application](https://dashboard.nexmo.com/applications/new) with Messages capabilities - point at a public URL where you will run this application
* Link your application to your Facebook page from the application settings
* Clone this repository
* Inside the project directory run `npm install`
* Rename `.env.example` to `.env` and populate credentials
* Run the application with `node index.js`