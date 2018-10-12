const GoogleAssistant = require('./node_modules/google-assistant/index.js');
const _ = require('underscore')
const path = require('path');
const request = require('request');
const fs  = require('fs-extra');

var config;
var isNew = true;

exports.init = function(){

	fs.ensureDirSync(__dirname + '/credentials/');

	if (!fs.existsSync(path.resolve(__dirname, 'credentials/' + Config.modules['Google-Assistant'].authorization.credentials)))
		return error("Credential file not exists, check documentation... Exit.".red);
	if (!fs.existsSync(path.resolve(__dirname, 'credentials/' + Config.modules['Google-Assistant'].authorization.tokens)))
		return error("Tokens file not exists, check documentation... Exit.".red);

	config = {
	  auth: {
		keyFilePath: path.resolve(__dirname, 'credentials/' + Config.modules['Google-Assistant'].authorization.credentials),
		savedTokensPath: path.resolve(__dirname, 'credentials/' + Config.modules['Google-Assistant'].authorization.tokens)
	  },
	  conversation: {
		lang: 'fr-FR'
	  }
	};
	
	Avatar.listen('GoogleHome', function(data){
		formatSentence (data.sentence, (sentence) => {
			start(data, data.client, sentence, (text, continueConversation) => {
					if (text)
						return Avatar.speak(text, data.client, function() {
							if (!continueConversation) Avatar.Speech.end(data.client);
						});
					else if (!continueConversation)
						Avatar.Speech.end(data.client);
			}, true);
		});
	});

}


exports.action = function(data, callback){

	if (!config) {
		warn ("Credential files not exist... Unable to continue".yellow);
		Avatar.Speech.end(data.client);
		return callback();
	}

	var tblActions = {
		start: function() {
							formatSentence (data.action.sentence, (sentence) => {
								start(data, data.client, sentence, (text, continueConversation) => {
										if (text)
											return Avatar.speak(text, data.client, function() {
												if (!continueConversation) Avatar.Speech.end(data.client);
											});
										else if (!continueConversation)
											Avatar.Speech.end(data.client);
								});
							});
		}
	};

  //Not mandatory
	//var client = setClient(data);
	info("Google-Assistant:", data.action.command.yellow, "From:", data.client.yellow);
	tblActions[data.action.command]();

	callback();

}


var setClient = function (data) {

	// client direct (la commande provient du client et est exécutée sur le client)
	var client = data.client;
	// Client spécifique fixe (la commande ne provient pas du client et n'est pas exécutée sur le client et ne peut pas changer)
	if (data.action.room)
		client = (data.action.room != 'current') ? data.action.room : (Avatar.currentRoom) ? Avatar.currentRoom : Config.default.client;

	// Client spécifique non fixe dans la commande HTTP (la commande ne provient pas du client et n'est pas exécutée sur le client et peut changer)
	if (data.action.setRoom)
		client = data.action.setRoom;

	return client;
}




function start (data, client, sentence, callback, trigger) {

	var textFromAssistant;
	var endSpeech;
	var type;

	const startConversation = (conversation) => {
	  conversation
		.on('response', (text) => {
		    if (text) {
				textFromAssistant =  formatText(text);
				info('Assistant Response:', textFromAssistant.yellow);
			} else {
				if (!type && !trigger)
					textFromAssistant = Config.modules['Google-Assistant'].noResponse;
				
				type = null;
			}
		})
		.on('volume-percent', (percent) => {
			/*
			if (!percent) percent = '100'; // Default
			info('New Volume Percent:', percent.yellow);
			info("Cette fonction test est implémentée sur le volume du Speaker du PC du client courant.".yellow);
			info("Créez un module-plugin pour gérer votre propre système de son !".yellow);

			setTimeout(function(){
				var uri = "http://localhost:" + Config.http.port + "/Avatar/generic?command=set_speaker&set="+percent+"&client=currentRoom&execOnClient=currentRoom&mobile=true"
				request({ 'uri' : uri }, function (err, response, body) {
						if (err || response.statusCode != 200) {
							warn("HTTP Error: ", err, response, body);
							return callback();
						}
				});
			}, 1000);	*/

		})
		.on('device-action', (action) => {
			type = 'device-action';
			var params = action.inputs[0].payload.commands[0].execution[0].params;

			if (!params.command) {
				warn("A device action must has a 'command' parameter".red);
				return callback();
			}
			if (!params.action) {
				warn("An action must has a 'action' parameter".red);
				return callback();
			}

			if (params.speech) textFromAssistant = params.speech;
			endSpeech = (params.end && params.end == 'true') ? false : true;

			switch (params.command.toLowerCase()) {
				case 'http' :
					// http request
					info('action',params.action )
					request({ 'uri' : params.action }, function (err, response, body) {
							if (err || response.statusCode != 200) {
								warn("HTTP Error: ", err, response, body);
								return callback();
							}
					});
					break;
				case 'plugin':
					// plugin
					if (!params.action.module) {
						warn("A Plugin action must has a 'module' parameter".red);
						return callback();
					}

					if (!Avatar.exists(params.action.module)) {
						warn((params.action.module + " plugin does not exist").red);
						return callback();
					}

					data.action = _.extend(data.action, params.action);
					Avatar.run(data.action.module, data);
					break;
				default:
					warn("An action must be 'http' or 'plugin'".red);
					return callback();
			}

		})
		// once the conversation is ended, see if we need to follow up
		.on('ended', (error, continueConversation) => {
		  if (error) {
			info('Conversation Ended Error:', error);
			callback();
		  } else if (continueConversation && textFromAssistant && !searchForNoAnswer(textFromAssistant)) {
				info('The conversation continues...'.green);
				ConversationNext(conversation, data, textFromAssistant, client, callback, trigger);
		  } else {
			info('Conversation Complete'.green);
			isNew = true;
			conversation.end();
			callback(textFromAssistant, endSpeech);
		  }
		})
		.on('error', (error) => {
		  info('Conversation Error:', error);
		  callback();
		});
	};

	const assistant = new GoogleAssistant(config.auth);
	assistant
		.on('ready', function() {
			config.conversation.isNew = isNew;
			config.conversation.textQuery = sentence;
			assistant.start(config.conversation, startConversation);
		})
		.on('error', (error) => {
		  info('Assistant Error:', error);
		  callback();
	});

}



function ConversationNext(conversation, data, tts, client, callback, trigger) {

	ttsToWav (client, tts, (filename) => {

		if (!filename) {
			isNew = true;
			conversation.end();
			return callback();
		}

		speak_states (client, filename, (timeout) => {

			if (!timeout) {
				timeout = Config.modules['Google-Assistant'].timeout.defaut * 1000;
				warn('Set default timeout for Google Assistant speak:', (timeout.toString() + 'ms').yellow);
			}

			timeout = Math.round((timeout + Config.modules['Google-Assistant'].timeout.waitForAnswer) * 1000);
			info('Timeout Google Assistant speak:', (timeout.toString() + 'ms').yellow);

			Avatar.askme (tts, client,
			Config.modules['Google-Assistant'].askmeResponse
			, timeout, (answer, end) => {
				end(client);
				if (!answer) {
					return Avatar.speak(Config.modules['Google-Assistant'].noAskmeResponse, client, function() {
						isNew = true;
						conversation.end();
					    callback();
					});
				}

				if (answer && answer.indexOf('tts_answer') != -1) {
					var answer = answer.split(':')[1];
					info('answer:', answer.yellow);
					isNew = false;
					return start (data, client, answer, callback, trigger);
				}

				Avatar.speak(Config.modules['Google-Assistant'].noAskmeResponse, client, function () {
					 isNew = true;
					 conversation.end();
					 callback();
				});
			});
		});
	});

}



function ttsToWav (client, tts, callback) {

	var exec = require('child_process').exec
	    , child;

	if (client.indexOf(' ') != -1) client = client.replace(/ /g,"_");

	// Construct a filesystem neutral filename
	var webroot = path.resolve(__dirname);
	var filepath = path.resolve(webroot, 'tts/' + client, 'speech.mp3');
	fs.ensureDirSync(webroot + '/tts/' + client);

	// Decode URI
	tts = decodeURIComponent(tts);
	// tts to wav
	var execpath = webroot + '/lib/vbs/ttstowav.vbs';

	child = exec( execpath + ' "'+ tts + '" "' + filepath + '"',
	  function (err, stdout, stderr) {
			if (err !== null) {
				error('tts to wav error: ' + err.red);
				callback();
			} else
				callback(filepath);
	  });
}




function speak_states (client, filename, callback) {

	var exec = require('child_process').exec
	, child;

	if (client.indexOf(' ') != -1) client = client.replace(/ /g,"_");

	// Construct a filesystem neutral filename
	var webroot = path.resolve(__dirname);
	var filepath = path.resolve(webroot, 'tts/' + client, 'speech.wav');

	var cmd = webroot + '/lib/sox/sox -q ' + filename + ' ' + filepath + ' stat -−json';
	var stats;
	var child = exec(cmd, function (err, stdout, stderr) {
		if (err) {
			error('Sox error:', err.red || 'Unable to start Sox'.red);
			callback();
		}
	});

	if (child)
		child.stdout.on("close", function() {
			setTimeout(function(){
				try {
					var json = fs.readFileSync(webroot + '/../../state.json','utf8');
						stats = JSON.parse(json);
						callback(stats.Length_seconds);
				} catch(ex){
					error("error: " + ex.message.red);
					callback();
				}
			}, 200);
		});
	else {
		error("No exec child process on speak state".red);
		callback();
	}

}


function searchForNoAnswer (sentence) {

	var even = _.find(Config.modules['Google-Assistant'].noResponse.split('|'), function(num){
		return sentence.toLowerCase().indexOf(num.toLowerCase()) != -1;
	});

	return even ? true : false;
}


function formatSentence(sentence, callback) {

	var even = _.find(Config.modules['Google-Assistant'].formatSentence.replace, function(num){
						return sentence.toLowerCase().indexOf(num[0].toLowerCase()) != -1;
			});

	if (even) {
		sentence = sentence.toLowerCase().replace(even[0].toLowerCase(), even[1]);
		info('new sentence', sentence.yellow);
	}
	return callback(sentence);

}


function formatText (text) {

	var tab= new RegExp('\r\n|\r|\n');
	var tblText=text.split(tab);
	text = '';
	for (var i=0; i<tblText.length; i++) {
		tblText[i] = tblText[i].replace('\\n','');

		if (Config.modules['Google-Assistant'].formatAnswer.exec) {
			Config.modules['Google-Assistant'].formatAnswer.truncat.map(function (truncat) {
				if (tblText[i].indexOf(truncat[0]) != -1) {
					var beginText = tblText[i].substring(0,tblText[i].indexOf(truncat[0]));
					var wiki = tblText[i].substring(tblText[i].indexOf(truncat[0]));
					var endText = wiki.substring(wiki.indexOf(truncat[1]) + truncat[1].length);
					tblText[i] = beginText + (endText.length != 1 ? endText : '');
				}
			});

			Config.modules['Google-Assistant'].formatAnswer.replace.map(function (toreplace) {
				tblText[i] = tblText[i].replace(new RegExp(toreplace[0], 'g'), toreplace[1]);
			});
		}

		tblNextText=tblText[i].split(' ');
		for (var a=0; a<tblNextText.length; a++) {
				for (var b = 0; b < tblNextText[a].length; b++) {
					var test = parseInt(fixedCharCodeAt(tblNextText[a], b));
					if(test > 128) {
						switch (test) {
							case 7497:
								if (b == tblNextText[a].length - 1) {
									newText = tblNextText[a].substring(0,b) + 'e';
									tblText[i] = tblText[i].replace(tblNextText[a], newText)
								}
								break;
							case 691:
								newText = tblNextText[a].substring(0,b) + 'er';
								tblText[i] = tblText[i].replace(tblNextText[a], newText)
						}
					}
				}
		}
		text = text + tblText[i];
		if (i+1 < tblText.length) text = text + ". ";
	}

	return text;
}


function fixedCharCodeAt (str, idx) {
    idx = idx || 0;
    var code = str.charCodeAt(idx);
    var hi, low;

    if (0xD800 <= code && code <= 0xDBFF) {
        hi = code;
        low = str.charCodeAt(idx+1);
        if (isNaN(low)) {
            throw "Le demi-codet supérieur n'est pas suivi "+
                  "par un demi-codet inférieur dans fixedCharCodeAt()";
        }
        return ((hi - 0xD800) * 0x400) + (low - 0xDC00) + 0x10000;
    }
    if (0xDC00 <= code && code <= 0xDFFF) {
        return false;
    }
    return code;
}
