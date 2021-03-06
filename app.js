'use strict';

const fs = require("fs");
const { spawn } = require('child_process');
const { EOL } = require('os');

const filelist = "filelist.txt"
const original_config = "rclone.conf";
const modified_config = "rclone_modified.conf";
const rcloneCommand = "rclone"; //If you are using Windows and rclone.exe is not in path, you want to change that to something like "C:/rclone/rclone.exe"
const writeDebugFile = true;
const debug_file_filename = "debug_file";
const amounts_of_retries_before_giveup = 1; //It shouldn't need to be larger than 1

var token = null;
var token_expiry_time = null;

function readTokenFromOriginalConfig() {
	try {
		let configContent = fs.readFileSync(original_config, { encoding: "utf-8" }).split(/\r?\n/);
		for (let i = 0; i < configContent.length; i++) {
			if (configContent[i].startsWith("token = ")) {
				token = configContent[i].replace("token = ", "");
				token_expiry_time = Date.parse(JSON.parse(token).expiry)
				console.log("token: " + token);
				console.log("token expiry time: " + token_expiry_time);
				//Debug
				if (writeDebugFile)
					fs.appendFileSync(debug_file_filename, Date() + "  " + token + EOL);
				//
			}
		}
	} catch (e) {
		console.log("encountered error trying to read token:  " + e);
	}

	if (token != null) {
		//starts downloading
		readFileList();
		if (!errorParsingFileList && folderIDList.length != 0) {
			console.log("Good to go.");
			downloadFile(0);
		}
	}
}

var folderIDList = [];
var destinationList = [];
var errorParsingFileList = false;
function readFileList() {
	try {
		let fileListContent = fs.readFileSync(filelist, { encoding: "utf-8" }).split(/\r?\n/);
		for (let i = 0; i < fileListContent.length; i++) {
			if (fileListContent[i] != "") {
				let array = fileListContent[i].split("===");
				if (array.length != 2) {
					console.log("error parsing this line: " + fileListContent[i]);
					errorParsingFileList = true;
				} else {
					folderIDList.push(array[0]);
					destinationList.push(array[1]);
				}
			}
		}
	} catch (e) {
		console.log("encountered error trying to read filelist:  " + e);
		errorParsingFileList = true;
	}
}

var downloadRetries = 0;
function downloadFile(index) {
	console.log("Copying Folder " + folderIDList[index] + " to " + destinationList[index]);
	//copy a config file with different folder ID
	if (fs.existsSync(modified_config))
		fs.unlinkSync(modified_config)
	fs.copyFileSync(original_config, modified_config);
	fs.appendFileSync(modified_config,
		EOL + "[tmp]" + EOL +
		"type = drive" + EOL +
		"scope = drive" + EOL +
		"root_folder_id = " + folderIDList[index] + EOL +
		"token = " + token + EOL);
	//

	//spawn rclone process
	const rclone = spawn(rcloneCommand, ["--config", modified_config, "-P", "copy", "tmp:", destinationList[index]], { stdio: 'inherit' });

	rclone.on('close', (code) => {
		readTokensFromModifiedConfig();
		console.log("child process exited with code" + code);
		if (code != 0) {
			if (downloadRetries < amounts_of_retries_before_giveup) {
				//Why retry is needed and what is this different from retry built into rclone:
				//When rclone updates the token to your Google Drive remote, it didn't update tmp remote's token
				//so you will get error messages because it can't read public shared folder...
				//need to re-copy your Google Drive token to tmp remote.
				downloadRetries++;
				downloadFile(index);
			} else {
				console.log("encountered an error, not continuing.");
			}
		} else if (index+1 == folderIDList.length) {
			console.log("I think we are done.");
		} else {
			downloadRetries = 0;
			downloadFile(index+1);
		}
	});
	//
}

function readTokensFromModifiedConfig() {
	//This function is used to find renewed token saved in modified config.
	//When rclone is running, it might renew a new token and save it in modified_config
	//, but modified_config is going to be replaced with content from original_config
	//, so we need to find and save the new token.
	try {
		let modifiedConfigContent = fs.readFileSync(modified_config, { encoding: "utf-8" }).split(/\r?\n/);
		for (let i = 0; i < modifiedConfigContent.length; i++) {
			if (modifiedConfigContent[i].startsWith("token = ")) {
				let tmp_token = modifiedConfigContent[i].replace("token = ", "");
				let tmp_token_expiry_time = Date.parse(JSON.parse(tmp_token).expiry)
				if (token != tmp_token && tmp_token_expiry_time > token_expiry_time) {
					console.log("I found a new token: " + tmp_token);
					console.log("old token is: " + token);
					console.log("new token expiry time: " + tmp_token_expiry_time);
					//Debug
					if (writeDebugFile)
						fs.appendFileSync(debug_file_filename,
							Date() + "  old token is " + token + EOL +
							Date() + "  new token is " + tmp_token + EOL);
					//
					//Modify original config to replace token with new one.
					let originalConfigFileContent = fs.readFileSync(original_config, { encoding: "utf-8" });
					originalConfigFileContent = originalConfigFileContent.replace(token, tmp_token);
					fs.writeFileSync(original_config, originalConfigFileContent);
					//
					token = tmp_token;
				}
			}
		}
	} catch (e) {
		console.log("encountered error trying to read token:  " + e);
	}
}

//Try to read new token before doing anything incase the script terminated with error last time.
//if (fs.existsSync(modified_config))
//	readTokensFromModifiedConfig();
readTokenFromOriginalConfig(); //This function should be called once and only once when you start the script.
