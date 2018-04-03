
//['http://127.0.0.1:4200', 'https://www.kittycash.com', 'https://staging.kittycash.com'];
//Check to make sure the required env variables have been set

if (!process.env.SERVER)
{
	console.log("You must set the SERVER environment variable.");
	console.log("EG: SERVER=https://upcat.pre-staging.kittycash.com");
	process.exit(1);
}

if (!process.env.ALLOWED_ORIGINS)
{
	console.log("You must set the ALLOWED_ORIGINS environment variable.");
	console.log("EG: ALLOWED_ORIGINS='https://www.kittycash.com https://staging.kittycash.com'");
	process.exit(1);
}
//Configuration options (Loaded from environment variables)
var io_server = process.env.SERVER;
var allowed_origins = process.env.ALLOWED_ORIGINS.split(' ');

//How long the key should remain valid
var key_validity = process.env.KEY_VALIDITY ? process.env.KEY_VALIDITY : 2000;
//The pixel_coefficient needs to match the pixel_coefficient in index.js of the game.  This is used to calculate distance to scores.
var pixel_coefficient = process.env.PIXEL_COEFFICIENT ? process.env.PIXEL_COEFFICENT : 0.025;
var port = process.env.PORT ? process.env.PORT : 3000;
var database_file = process.env.DATABASE_FILE ? process.env.DATABASE_FILE : "./db.json";


var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var aesjs = require('aes-js');
var moment = require('moment');

//Initialize lowdb (for saving and querying scores)
var low = require('lowdb')
var FileSync = require('lowdb/adapters/FileSync')
var adapter = new FileSync(database_file)
var db = low(adapter)

//Setup swig for templating
var swig = require('swig');
app.engine('html', swig.renderFile);
app.set('view engine', 'html');
app.set('views', __dirname + '/game');
app.set('view cache', true);

//Host the game files
app.use(express.static('game'));

// Set the defaults (required if your JSON file is empty)
db.defaults({ scores: [] })
  .write()

//users{} stores the current socket connections and statuses in memory
var users = {};

app.use(function (req, res, next) {
	var origin = req.headers.origin;

	if(allowed_origins.indexOf(origin) > -1){
       res.setHeader('Access-Control-Allow-Origin', origin);
 	}

    res.setHeader('Access-Control-Allow-Methods', 'GET');
    next();
});

app.get('/game', function(req, res){
	var show_scoreboard_link = req.query.show_scoreboard_link === 'true' ? true : false;
	res.render('index', {
		io_server: io_server, 
		show_scoreboard_link: show_scoreboard_link
	});
});

app.get('/scores/:span', function(req, res) {

	var span = req.params.span;

	switch (span) {
    case 'day':
        span = "day";
        break;
    case 'week':
        span = "week";
        break;
    case 'month':
        span = "month";
        break;
    default: 
    	span = "day";
	}

	scores = getTop(span);
	res.send({scores: scores, span: span});
});

io.on('connection', function(socket){
 
  users[socket.id] = { };
  var client_ip = socket.request.connection.remoteAddress;
  users[socket.id].client_ip = client_ip;

  setInterval(function(str1, str2) {
	  var key = [];

	  for (var i = 0; i < 32; i++)
	  {
	  	key.push(Math.floor(Math.random() * (254 - 0 + 1)) + 0);
	  }

	  users[socket.id].key = key;
	  users[socket.id].created_at = Date.now();

	  socket.emit('update key',users[socket.id]);
  }, key_validity);

  socket.on('start game', function(data) {
  	var data = decrypt(socket.id, data.data);

  	if (data && data.decoded)
  	{
  		users[socket.id].started_at = Date.now();
  		users[socket.id].achievements = [];
  		console.log("Game started!");
  	}
  	
  });

  socket.on('achievement', function(data) {
  	var data = decrypt(socket.id, data.data);

  	if (data && data.decoded)
  	{
  		var diff = 0;
  		if (users[socket.id] && users[socket.id].achievments && users[socket.id].achievements.length > 0)
  		{
  			var last_achievment = users[socket.id].achievements[users[socket.id].achievements.length -1];
  			diff = (Date.now() - last_achievment.created_at);
  		}
  		
  		users[socket.id].achievements.push({created_at: Date.now(), distance: data.distance, diff: diff});
  	}
  });
  socket.on('finish game', function (data) {
  	var data = decrypt(socket.id, data.data);

  	if (data && data.decoded)
  	{
  		//Wait for the key validity for some more data to come in
  		setTimeout(function(){
  			var distance = data.distance;
	  		var calc_distance = Math.round(pixel_coefficient * data.distance);

	  		var expected_achievments = Math.floor(calc_distance / 100);

	  		if (expected_achievments != users[socket.id].achievements.length)
	  		{
	  			console.log("Achievments don't match!");
	  			console.log("Expected: " + expected_achievments + " Received: " + users[socket.id].achievements.length);
	  			console.log("\n\n");
	  			return;
	  		}

	  		var game_time = Date.now() - users[socket.id].started_at;

	  		var achievement_sum = 0;
	  		for (var i = 0; i < users[socket.id].achievements.length; i++)
	  		{
	  			achievement_sum += users[socket.id].achievements[i].diff;

	  			if (i == users[socket.id].achievements.length - 1)
	  			{
	  				//Our last one.  Add the last diff
	  				achievement_sum += Date.now() - users[socket.id].achievements[i].created_at;
	  			}
	  		}

	  		var game_diff = game_time - achievement_sum;

	  		if (game_diff > 15000 || game_diff < -15000)
	  		{
	  			console.log("Invalid game diff");
	  			return;
	  		}

	  		console.log("This is a valid game!");

	  		//Create a key to input the name to
	  		require('crypto').randomBytes(48, function(err, buffer) {
			  var token = buffer.toString('hex');

			  users[socket.id].token = token;
			  users[socket.id].score = calc_distance;
			  socket.emit('input telegram',{token: token});
			});
  		}, 0);
  		
  	}
  });

	socket.on('save score', function (data) {
		if (data && data.token && users[socket.id] && users[socket.id].token && data.token == users[socket.id].token)
		{
			console.log("Saving user: " + data.telegram + " with a score of: " + users[socket.id].score);

			db.get('scores')
			  .push({ created_at: new Date(), telegram: data.telegram, score: users[socket.id].score, user_data: users[socket.id]})
			  .write();
		}
	});
});


function getTop(type)
{
	return db.get('scores')
	  .filter(function (v) {
	  	return new moment(v.created_at) > moment().subtract(1,type)
	  })
	  .sortBy('score')
	  .take(5)
	  .value()
	  .reverse();
}

function decrypt(socket_id, encryptedHex)
{
	if (users && users[socket_id] && Date.now() - users[socket_id].created_at < key_validity)
	{
		var key = users[socket_id].key;
		var c = users[socket_id].client_ip.match(/^\d+|\d+\b|\d+(?=\w)/g);
		var counter = c.length > 0 ? parseInt(c[0]) : 0;

		// When ready to decrypt the hex string, convert it back to bytes
		var encryptedBytes = aesjs.utils.hex.toBytes(encryptedHex);

		// The counter mode of operation maintains internal state, so to
		// decrypt a new instance must be instantiated.
		var aesCtr = new aesjs.ModeOfOperation.ctr(key, new aesjs.Counter(counter));
		var decryptedBytes = aesCtr.decrypt(encryptedBytes);

		// Convert our bytes back into text
		var decryptedText = aesjs.utils.utf8.fromBytes(decryptedBytes);
		var ret = JSON.parse(decryptedText);
		ret.decoded = true;
		return ret;
	}
	else
	{
		console.log("Key expired");
		return false;
	}
}

http.listen(port, function(){
  console.log('listening on *:' + port);
});