/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope Public
 */

const gitToken = 'TOKEN'; // GitHub API Token
const gitOwner = 'USER'; // GitHub Username
const userLastName = 'LASTNAME'; // Last name of user you want to search
const gitType = 'Bearer';

define(['N/query', 'N/config','N/runtime', 'N/https', 'N/encode', 'N/file', 'N/record'],
// NS -> GIT Sync will sync any script to GitHub for a given user last name. Since GitHub is used as a reference, assuming latest updates in NetSuite, script will delete and recreate repository.

function(query, config, runtime, https, encode, file, record) {

function _sendToGit(git_repo,id,type,title,deploy,gitToken,gitType,gitOwner) {
	try {
		if (!type) {
			var type = 'Other';
		}		
		var fileObj = file.load({
			id: id
		});
		var fileSha = fileObj.description||'';
		var fileContents = fileObj.getContents();
		var encodedFile = encode.convert({
			string: fileContents,
			inputEncoding: encode.Encoding.UTF_8,
			outputEncoding: encode.Encoding.BASE_64
		});
		if (title && deploy) {
			var formMessage = 'Name: ' + title + ' Deployment: ' + deploy;
		}
		else {
			var formMessage = fileObj.name;
		}
		var formData = {};
		formData.message = formMessage;
		if (fileSha) {
			formData.sha = fileSha;
		}
		formData.content = encodedFile;
		var headers = '{"Authorization": "' + gitType + " " + gitToken + '","Content-Type":"multipart/form-data"}';
		var header = JSON.parse(headers)
		var git_url = "https://api.github.com/repos/" + gitOwner + "/"+ git_repo +"/contents/" + type + "/" + fileObj.name;
		var apiResponse=https.put({
			url: git_url,
			headers:header,
			body:JSON.stringify(formData)
		});
		var responseBody = JSON.parse(apiResponse.body);
		log.debug('File sent', apiResponse.body);
	}
	catch(e) {
		log.debug('Failed to send ' + id,e.message);
	}
	return true;
}

function getInputData() {
	var configRecObj = config.load({
		type: config.Type.COMPANY_INFORMATION
	});
	var coName = configRecObj.getValue({fieldId: 'companyname'});
	try {
	var usql = `select id from employee where lastname like '${userLastName}' or entityid like '%${userLastName}%'`;
		var uResults = query.runSuiteQL({query: usql}).asMappedResults();
		var uId = uResults[0].id||'';
		if (uId) {
			var searchFiles = searchForFiles(uId);
			var searchInfo = searchForInfo(uId, searchFiles); 
			var headers = '{"Authorization": "' + gitType + " " + gitToken + '","Content-Type":"text/plain"}';
			var header = JSON.parse(headers)
			var accountId = runtime.accountId;
			var formData = {};
			formData.name = accountId;
			formData.description = coName + ' ' + runtime.envType;
			formData.private = true;
			formData.visibility = "private";
			formData.has_issues = false;
			formData.has_projects = false;
			formData.has_wiki = false;
			var git_url = "https://api.github.com/repos/" + gitOwner + '/' + accountId;
			var apiResponse=https.delete({
				url: git_url,
				headers:header
			});
			var git_url = "https://api.github.com/user/repos";
			var apiResponse=https.post({
				url: git_url,
				headers:header,
				body:JSON.stringify(formData)
			});
			var responseBody = JSON.parse(apiResponse.body);
			var repoName = responseBody.name||'';
			return searchInfo;
		}
		else {
			return false;
		}
	}
	catch(e) {
		log.error({title: 'GetInputData - error', details: {'error': e}});
	}
}

function searchForFiles(uId) {
	try {
		var sql = `
			select f.id, f.name, f.filetype, f.folder, replace(mf.appfolder,' : ','/') path from file f 
			join systemnote sn on sn.recordid = f.id 
			join mediaitemfolder mf on mf.id = f.folder
			where field='MEDIAITEM.NKEY' and mf.appfolder like '%SuiteScripts%' and sn.name = ${uId}
		`;
		var fileResults = query.runSuiteQL({query: sql}).asMappedResults();
	} catch(e) {		
		log.error({title: 'selectFiles - error', details: {'error': e}});
	}	
	return fileResults;
}

function searchForInfo(uId, searchFiles) {
	try {	
		var sql = `
			select 'Scheduled' type, sd.id, sd.title, sd.scriptid, sd.script, sd.deploymentid, ss.scriptid, ss.owner, ss.scriptfile from scheduledscriptdeployment sd join scheduledscript ss on ss.id = sd.script  where sd.isdeployed = 'T' and ss.owner = ${uId}
			union
			select 'Client' type, cd.id, cd.recordtype, cd.scriptid, cd.script, cd.deploymentid, cs.scriptid, cs.owner, cs.scriptfile from clientscriptdeployment cd join clientscript cs on cs.id = cd.script where cd.isdeployed = 'T' and cs.owner = ${uId}
			union
			select 'MRS' type, md.id, md.title, md.scriptid, md.script, md.deploymentid, ms.scriptid, ms.owner, ms.scriptfile from mapreducescriptdeployment md join mapreducescript ms on ms.id = md.script where md.isdeployed= 'T' and ms.owner = ${uId}
			union
			select 'User' type, ud.id, ud.recordtype, ud.scriptid, ud.script, ud.deploymentid, us.scriptid, us.owner, us.scriptfile from usereventscriptdeployment ud join usereventscript us on us.id = ud.script where ud.isdeployed= 'T' and us.owner = ${uId}
			union
			select 'Suitelet' type, sd.id, sd.title, sd.scriptid, sd.script, sd.deploymentid, su.scriptid, su.owner, su.scriptfile from suiteletdeployment sd join suitelet su on su.id = sd.script where sd.isdeployed='T' and su.owner = ${uId}
		`;
		var infoResults = query.runSuiteQL({query: sql}).asMappedResults();
		searchFiles.forEach(function(file) {
			var fileId = Number(file.id);
			for (var i = 0; i < infoResults.length; i++) {
				let infoFileId = Number(infoResults[i].scriptfile);
				if (fileId === infoFileId) {
					file.type = infoResults[i].type;
					file.title = infoResults[i].title;
					file.scriptid = infoResults[i].scriptid;
					break;
				}
			}
			return true;
		});
	} catch(e) {		
		log.error({title: 'selectInfo - error', details: {'error': e}});
	}	
	return searchFiles;
}

function map(context) {
	
	var data = JSON.parse(context.value);
	var repoName = runtime.accountId;
	_sendToGit(repoName, data.id, data.type, data.title, data.scriptid, gitToken, gitType, gitOwner);
}

function summarize(context) {
	var folders = ["Client","MRS","Other","Scheduled","Suitelet","User"];
	folders.forEach(function(f) {
	var formData = {};
	formData.message = f;
	formData.content = "";
	var header = new Array();
	var headers = '{"Authorization": "' + gitType + " " + gitToken + '","Content-Type":"multipart/form-data"}';
	var header = JSON.parse(headers)
	var git_url = "https://api.github.com/repos/" + gitOwner + "/" + runtime.accountId + "/contents/" + f + "/header.txt";
	var apiResponse=https.put({
      url: git_url,
      headers:header,
	  body:JSON.stringify(formData)
    });
	log.debug('Git complete', apiResponse.body);
	return true;
	});
}	

    return {
        getInputData: getInputData,
        map: map,
		summarize: summarize
        };
});
