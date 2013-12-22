var defaults = {
	addContextMenuItem : 'yes',
	archiveTrigger     : 'none',
	checkInterval      : '600',
	defaultAction      : 'showlist',
	defaultFilterSet   : 'All',
	defaultPageView    : 'normal',
	defaultService     : 'pocket',
	downloadLimit      : '1000',
	loggingEnabled     : 'no',
	newExcludesTagged  : 'no',
	pinMethod          : 'fave',
	reloadOnUpdate     : 'no',
	showAddDialog      : 'no',
	sortOldestFirst    : 'no',
	useAlternateIcon   : 'no',
	useNewWindow       : 'no',
	filterSets : JSON.stringify({
		'All' : {
			service     : 'pocket',
			urlPatterns : [],
			tags        : [],
			newWindow   : undefined,
			markReadOn  : 'focus'
		},
	}),
};
var services = {
	'pocket' : {
		name : 'Pocket',
		consumerkey: apiKeys.pocket,
		endpoints : {
			'get'  : 'https://getpocket.com/v3/get',
			'add'  : 'https://getpocket.com/v3/add',
			'send' : 'https://getpocket.com/v3/send',
			'read' : 'http://getpocket.com/a/read/'
		}
	}
};
var faviconRegex = /<link.* rel=['"](?:shortcut )?icon['"][^>]* href=['"]([^'"]+)['"][^>]*>/i;
var ls = localStorage;
var a = document.createElement('a');
var div = document.createElement('div');

function XhrDataObj(type, members) {
	if (type === 'pocket') {
		this.consumer_key = services['pocket'].consumerkey;
		this.access_token = localStorage.oAuthAccessToken;
	}
	for (var k in members) {
		this[k] = members[k];
	}
}
function addLinkToService(url, callback) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (this.readyState == 4) {
			clearTimeout(xhr.timeout);
			if (this.status == 200) {
				var html = this.responseText;
				var titleExec = /<title[^>]*>([^<]+)<\/title>/.exec(html);
				var title = titleExec ? titleExec[1] : url;
				var data = {
					url   : url,
					title : title,
					tags  : ''
				};
				submitItem(data, function onSuccess() {
					runBackgroundUpdate();
					var baseUrl = getBaseUrl(url);
					var cachedIcon = getCachedFavicon(baseUrl);
					if (cachedIcon) {
						console.log('Cached icon found for:', url);
					} else {
						var faviconUrlSearch = faviconRegex.exec(html);
						if (faviconUrlSearch && faviconUrlSearch[1]) {
							var iconUrl = getFullyQualifiedIconUrl(faviconUrlSearch[1], baseUrl);
							console.log('Fetching icon at url:', iconUrl);
							getFaviconFromUrl(iconUrl, function (result) {
								if (result) {
									cacheFavicon(result, baseUrl);
									console.log('Cached favicon for:', url);
								}
							});
						}
					}
					callback(true);
				}, function onFailure() { callback(false) });
			} else {
				// console.log(this.status, this.statusText, this.responseText);
				// console.log('Response headers:', this.getAllResponseHeaders());
			}
		}
	};
	xhr.open('GET', url, true);
	xhr.send();
	xhr.timeout = setTimeout(function () {
		xhr.abort();
		console.log('XHR timed out getting "' + url + '"');
	}, 15000);
	return;
}
function addTabToService(data, callback) {
	var data = {
		url   : data.url,
		title : data.title,
		tags  : data.tags || ''
	};
	var isNew = !getItemByUrl(data.url);
	var dialogShown = (localStorage.showAddDialog == 'yes');
	submitItem(data, function onSuccess() {
		runBackgroundUpdate();
		callback(isNew && !dialogShown ? true : null);
	}, function onFailure() { callback(false) });
}
function archiveItem(item, onSuccess, onFailure) {
	// console.log('archiveItem:', item);
	modifyItem(item, 'archive', null, onSuccess, onFailure);
}
function archiveItems(items, onSuccess, onFailure) {
	modifyItems(items, 'archive', [], {}, function () {
		items.forEach(function (item) { item.state = '1' });
		var unreadCount = itemCache.filter(isUnread).length;
		setBadge((unreadCount || '') + '');
		onSuccess && onSuccess();
	}, onFailure);
}
function cacheFavicon(iconData, baseUrl) {
	localStorage['favicon@' + baseUrl] = JSON.stringify({
		data : iconData,
		time : new Date().getTime()
	});
}
function convertPinsTo(method) {
	updateItems(JSON.parse(localStorage.cacheTime), function onSuccess() {
		var isPinned, repinItem, addAction, pinnedItems, actionsArray = [];
		if (method == 'fave') {
			isPinned  = function (item) { return item.tags.indexOf('pinned') > -1 };
			repinItem = function (item) { item.faved = '1' };
			addAction = function (item) {
				actionsArray.push({
					action  : 'favorite',
					item_id : item.id
				});
			};
		} else
		if (method == 'tag') {
			isPinned  = function (item) { return item.faved == '1' };
			repinItem = function (item) { item.tags.push('pinned') };
			addAction = function (item) {
				actionsArray.push({
					action  : 'tags_add',
					item_id : item.id,
					tags    : ['pinned']
				});
			};
		}
		pinnedItems = itemCache.filter(isPinned);
		pinnedItems.forEach(addAction);
		var xhrData = new XhrDataObj('pocket', { actions: JSON.stringify(actionsArray) });
		doXHR({
			method    : 'POST',
			url       : services[localStorage.defaultService].endpoints['send'],
			data      : xhrData,
			onSuccess : function () {
				pinnedItems.forEach(repinItem);
				localStorage.itemCache = JSON.stringify(itemCache);
			}
		});
	});
}
function createItemArray(xhr, service) {
	var itemArray = [];
	if (service === 'pocket') {
		var i, o, listObj = JSON.parse(xhr.responseText).list;
		for (i in listObj) {
			o = listObj[i];
			if (o.given_url || o.resolved_url) {
				itemArray.push({
					id      : o.item_id,
					url     : o.given_url || o.resolved_url,
					title   : o.given_title || o.resolved_title,
					blurb   : /</.test(o.excerpt) ? getPlainText(o.excerpt) : o.excerpt,
					tags    : (o.tags) ? getTagArray(o) : [],
					faved   : o.favorite,
					time    : (o.time_added + '000') * 1,
					state   : o.status,
					service : 'pocket',
					hits    : (localStorage[o.item_id] * 1) || 0
				});
			}
		}
	}
	return itemArray;
}
function cullOldFavicons() {
	var now = new Date().getTime();
	for (var key in localStorage) {
		if (/^favicon/.test(key)) {
			var cacheTime = JSON.parse(localStorage[key]).time;
			if (cacheTime < (now - 2592000000)) {
				delete localStorage[key];
				console.log('Deleted old favicon:', key);
			}
		}
	}
}
function dataObj2Str(data) {
	if (!data) return null;
	if (typeof data === 'string') return data;
	var string = '';
	for (var key in data) {
		string += key + '=' + encodeURIComponent(data[key]) + '&';
	}
	return string.slice(0, string.length - 1);
}
function defineFilter(name, filterObject) {
	var filterSets = JSON.parse(localStorage.filterSets);
	filterSets[name] = filterObject;
	localStorage.filterSets = JSON.stringify(filterSets);
}
function deleteItem(item, onSuccess, onFailure) {
	// console.log('deleteItem:', item.id, item);
	modifyItem(item, 'delete', null, function () {
		itemCache = itemCache.filter(function (i) { return i.id != item.id });
		localStorage.itemCache = JSON.stringify(itemCache);
		if (localStorage.checkInterval * 1) {
			var unreadCount = itemCache.filter(isUnread).length;
			setBadge((unreadCount || '') + '');
		}
		if (onSuccess) onSuccess();
	}, onFailure);
}
function deleteCachedFavicons() {
	for (var key in localStorage) {
		if (/^favicon/.test(key)) {
			delete localStorage[key];
		}
	}
}
function doXHR(args) {
	// method, url, data, successHandler, errorHandler
	// console.log('doXHR called from ' + arguments.callee.caller.name + ' with data:', args.data);
	console.log('XHR endpoint: "' + args.url + '"');
	var timerID = Math.random().toString().slice(2);
	if (args.data) args.data = dataObj2Str(args.data);
	var callingPocket = /(getpocket)|(readitlaterlist)\.com/.test(args.url);
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (this.readyState === 4) {
			// console.log("Response time: " + ((t[1] = new Date()) - t[0]) + "ms");
			clearTimeout(xhr.timeout);
			if (xhr.waiting) {
				clearTimeout(xhr.waiting);
				delete xhr.waiting;
				if (chrome) setButtonIcon(getDefaultIconForActiveTab()); else
				if (safari && waitingButton) animateButton(waitingButton, timerID, false);
			}
			if (this.status === 200) {
				var xlkr = this.getResponseHeader('X-Limit-Key-Reset');
				console.log('Status:', this.getResponseHeader('Status'));
				if (args.onSuccess) {
					args.onSuccess(this);
				} else {
					console.log('Response headers:', this.getAllResponseHeaders());
					console.log((function () {
						try {
							return JSON.parse(this.responseText);
						} catch(e) {
							return this.responseText;
						}
					})());
				}
			} else {
				console.log(this.status, this.statusText, this.responseText);
				console.log('Response headers:', this.getAllResponseHeaders());
				if (callingPocket) {
					if (this.status == '401')
						delete localStorage.oAuthAccessToken;
					_gaq.push([
						'_trackEvent', 'Pocket API Errors', 
						this.getResponseHeader('Status'), 
						this.getResponseHeader('X-Error')
					]);
				}
				if (args.onFailure) {
					args.onFailure(this);
				} else {
					if (chrome) handleXhrErrorWithAlert(this, true); else
					if (safari) reportXhrError(this, null);
				}
			}
		}
	};
	if (args.method === 'GET' && args.data)
		args.url = args.url + '?' + args.data;
	xhr.open(args.method, args.url, true);
	if (args.method === 'POST')
		xhr.setRequestHeader("Content-type", "application/x-www-form-urlencoded");
	xhr.send(args.data || null);
	var t = []; t[0] = new Date();
	xhr.waiting = setTimeout(function () {
		if (chrome) setButtonIcon(waitingIcon); else
		if (safari) {
			waitingButton = getMainButtonForActiveWindow();
			animateButton(waitingButton, timerID, true);
		}
	}, 5000);
	xhr.timeout = setTimeout(function () {
		if (chrome) setButtonIcon(getDefaultIconForActiveTab()); else
		if (safari && waitingButton) animateButton(waitingButton, timerID, false);
		if (args.onFailure) {
			args.onFailure(xhr);
		} else {
			var sName = services[localStorage.defaultService].name;
			if (chrome) showAlert('Pickpocket could not connect to your ' + sName + ' account.'); else
			if (safari) {
				showReport('Pickpocket could not connect to your ' + sName + ' account.');
			}
		}
		xhr.abort();
	}, 15000);
}
function findCachedFavicon(searchString) {
	for (var key in localStorage) {
		if (new RegExp('^favicon@.*' + searchString.replace(/\./g, '\\.')).test(key)) {
			var iconObject = JSON.parse(localStorage[key]);
			console.log(key);
			console.log(iconObject.data);
		}
	}
}
function finishUpdatingItems(callback) {
	itemCache.sort(function (a, b) {
		return b.time - a.time;
	});
	localStorage.itemCache = JSON.stringify(itemCache);
	localStorage.cacheTime = new Date().getTime();
	// console.log('Updated itemCache.length:', itemCache.length);
	if (localStorage.checkInterval * 1) {
		var unreadCount = itemCache.filter(isUnread).length;
		setBadge((unreadCount || '') + '');
	}
	if (callback) callback();
}
function getAllItemUrls(items, service) {
	if (service === 'pocket') {
		var getItemUrl = function (item) { return item.url };
		return items.map(getItemUrl);
	} else return [];
}
function getAllTags() {
	return _.chain(itemCache).map(function (item) { return item.tags }).flatten().sort().uniq(true).value();
}
function getBaseUrl(pageUrl) {
	a.href = pageUrl;
	return a.protocol + '//' + a.host;
}
function getCachedFavicon(baseUrl) {
	var lsItem = localStorage['favicon@' + baseUrl];
	if (lsItem) {
		var cachedIconEntry = JSON.parse(lsItem);
		if (cachedIconEntry.time > (new Date().getTime() - 2592000000)) {
			return cachedIconEntry.data;
		} else {
			delete localStorage['favicon@' + baseUrl];
		}
	}
	return null;
}
function getFavicon(pageUrl, callback) {
	var baseUrl = getBaseUrl(pageUrl);
	var firstCallback = function (result) {
		if (result) {
			finalCallback(result);
		} else {
			// console.log('No favicon.ico at ' + baseUrl + '; trying alternate method.');
			getFaviconUrlFromPage(pageUrl, secondCallback);
		}
	};
	var secondCallback = function (result) {
		if (result) {
			// console.log('Favicon web url found:', result);
			getFaviconFromUrl(result, finalCallback);
		} else {
			console.log('No favicon found for', pageUrl);
			finalCallback('');
		}
	};
	var finalCallback = function (result) {
		cacheFavicon(result || '', baseUrl);
		callback(result);
	};
	var cachedIcon = getCachedFavicon(baseUrl);
	if (cachedIcon == null) {
		getFaviconFromUrl(baseUrl + '/favicon.ico', firstCallback);
	} else {
		callback(cachedIcon);
	}
}
function getFaviconFromUrl(iconUrl, callback) {
	if (window.FileReader) {
		var xhr = new XMLHttpRequest();
		xhr.onreadystatechange = function () {
			if (this.readyState == 4) {
				if (this.status == 200) {
					var blob = this.response;
					var reader = new FileReader();
					reader.onload = function (e) {
						var result = e.target.result;
						if (result == 'data:') result = '';
						callback(result);
					}
					reader.readAsDataURL(blob)
				} else {
					callback(null);
				}
			}
		};
		xhr.open('GET', iconUrl, true);
		xhr.responseType = 'blob';
		xhr.send();
	} else {
		callback(null);
	}
}
function getFaviconUrlFromPage(pageUrl, callback) {
	var xhr = new XMLHttpRequest();
	xhr.onreadystatechange = function () {
		if (this.readyState == 4) {
			if (this.status == 200) {
				var regexResult = faviconRegex.exec(this.responseText);
				if (regexResult && regexResult[1]) {
					callback(regexResult[1]);
				} else {
					callback(null);
				}
			} else {
				callback(null);
			}
		}
	};
	xhr.open('GET', pageUrl, true);
	xhr.send();
}
function getFullyQualifiedIconUrl(url, baseUrl) {
	a.href = url;
	if (!/^http/.test(a.protocol))
		return baseUrl + url;
	return url;
}
function getItemByUrl(url) {
	if (!itemCache) return null;
	for (var item, i = 0; i < itemCache.length; i++) {
		item = itemCache[i];
		if (item.url == url) {
			return item;
		}
	} return null;
}
function getItemFromId(id) {
	for (var item, i = 0; i < itemCache.length; i++) {
		item = itemCache[i];
		if (item.id == id) {
			return item;
		}
	} return null;
}
function getItems(service, since, state, limit, callback, badCallback) {
	if (service === 'pocket') {
		var method = 'GET';
		var pSince = (since) ? Math.round(since/1000) + '' : '';
		var data = new XhrDataObj('pocket', {
			count      : limit,
			since      : pSince,
			state      : (state || ''),
			detailType : 'complete',
			sort       : 'newest'
		});
	}
	var url = services[service].endpoints['get'];
	var startTime = new Date();
	doXHR({
		method    : method,
		url       : url,
		data      : data,
		onSuccess : function (xhr) {
			console.log('Download finished in', new Date() - startTime, 'ms');
			callback && callback(createItemArray(xhr, service));
		},
		onFailure : badCallback
	});
}
function getPlainText(html) {
	div.innerHTML = html.replace(/<script[^>]*>/g, '');
	return div.textContent;
}
function getRandomUnreadItem() {
	var unreadItems = getUnreadItems();
	var rIndex = Math.floor(unreadItems.length * Math.random());
	return unreadItems[rIndex];
}
function getTagArray(itemObj) {
	var tagArray = [];
	for (var key in itemObj.tags)
		tagArray.push(key);
	return tagArray;
}
function getUnreadItems() {
	return itemCache.filter(isUnread);
}
function incrementHitCount(cachedItem) {
	// "this" is the opened item's id
	if (this == cachedItem.id) {
		cachedItem.hits++;
		// console.log('Item ' + cachedItem.title + ' hit count incremented to ' + cachedItem.hits);
	}
}
function initialize() {
	console.log = (localStorage.loggingEnabled == 'yes') ? console.log : function () {};
	itemCache = localStorage.itemCache ? JSON.parse(localStorage.itemCache) : null;
	localStorage.cacheTime = localStorage.cacheTime || 'null';
	
	initializeSettings();
	cullOldFavicons();
	
	if (localStorage.oAuthAccessToken) {
		if (chrome) applyDefaultAction();
		scheduleCheckForNewItems();
		setTimeout(runBackgroundUpdate, 1000);
	} else {
		beginAuthProcess();
	}
}
function isUnread(item) {
	return item.state == '0';
}
function itemPassesFilter(item) {
	var filterSet = this;
	var itemPassesFilterSet = false;
	var urlIsGood = function () {
		if (filterSet.urlPatterns.length === 0) return true;
		else return filterSet.urlPatterns.some(urlFitsPattern, item.url);
	};
	var someTagIsGood = function () {
		if (filterSet.tags.length === 0) {
			return true;
		} else
		if (tags.length === 0) {
			return (filterSet.tags.length === 0);
		} else
		return item.tags.some(tagIsInFilter, filterSet.tags);
	};
	return urlIsGood() && someTagIsGood();
}
function listCachedFavicons() {
	for (var key in localStorage) {
		if (/^favicon/.test(key)) {
			var iconObject = JSON.parse(localStorage[key]);
			console.log(key, '\n\t"' + iconObject.data.slice(0, 80) + '"');
		}
	}
}
function makeActionObject(item) {
	var actionObject = { action: this.action };
	this.props.forEach(function (prop) {
		actionObject[prop] = item[prop];
	});
	for (var key in this.data) {
		actionObject[key] = this.data[key];
	}
	if (this.action != 'add') {
		actionObject.item_id = item.id;
	}
	return actionObject;
}
function modifyItem(item, action, data, onSuccess, onFailure) {
	if (!item.service) {
		alert('Error in archiving item ' + item.title);
		return;
	}
	if (item.service === 'pocket') {
		var method = 'POST';
		var actionObject = {
			action  : action,
			item_id : item.id
		};
		for (var key in data) {
			actionObject[key] = data[key];
		}
		var xhrData = new XhrDataObj('pocket', { actions: JSON.stringify([actionObject]) });
	}
	var url = services[item.service].endpoints['send'];
	doXHR({
		method    : method,
		url       : url,
		data      : xhrData,
		onSuccess : onSuccess,
		onFailure : onFailure
	});
}
function modifyItems(items, action, props, data, onSuccess, onFailure) {
	var actionObjects = items.map(makeActionObject, { action:action, props:props, data:data });
	// console.log('actionObjects:', actionObjects);
	var xhrData = new XhrDataObj('pocket', { actions: JSON.stringify(actionObjects) });
	var url = services['pocket'].endpoints['send'];
	doXHR({
		method    : 'POST',
		url       : url,
		data      : xhrData,
		onSuccess : onSuccess,
		onFailure : onFailure
	});
}
function reifyUrlPattern(s) {
	return new RegExp(s.replace(/\./g, '\\.').replace(/\*/g, '.*'));
}
function replaceOrAdd(item) {
	for (var i = itemCache.length - 1; i >= 0; i--) {
		if (itemCache[i].id === item.id) {
			// console.log('Item to delete:', itemCache[i].title);
			itemCache.splice(i, 1);
			break;
		}
	}
	itemCache.unshift(item);
	var downloadLimit = (localStorage.downloadLimit * 1 > 0) ? localStorage.downloadLimit * 1 : defaults.downloadLimit * 1;
	if (itemCache.length > downloadLimit) {
		itemCache.splice(downloadLimit);
	}
}
function resetItemCache() {
	// console.log('Resetting item cache.');
	itemCache = null;
	delete localStorage.itemCache;
	localStorage.cacheTime = 'null';
	setBadge('');
}
function runBackgroundUpdate() {
	if (!localStorage.oAuthAccessToken) return;
	updateItems(JSON.parse(localStorage.cacheTime), null, function onFailure() {
		console.log('Background update failed.');
	});
	_gaq.push(['_trackEvent', 'Program Actions', 'Background Update']);
}
function runFilterSet(filterSet, zeroItemCallback) {
	filterSet = filterSet || JSON.parse(localStorage.filterSets)[localStorage.defaultFilterSet];
	getItems(filterSet.service, null, 'unread', 100, function (items) {
		// console.log('Unread items:', items);
		var serviceName = services[localStorage.defaultService].name;
		var filteredItems = items;	//.filter(itemPassesFilter, filterSet);
		if (filteredItems.length > 0) {
			if (filteredItems.length < 10) {
				openItems(filteredItems, filterSet);
			} else {
				var question = 'You are about to open ' + filteredItems.length + ' links. Proceed?';
				getConfirmation(question, function (confirmed) {
					if (confirmed) openItems(filteredItems, filterSet);
				});
			}
		} else zeroItemCallback();
	});
}
function scheduleCheckForNewItems() {
	if (window.checkTimer) {
		clearInterval(window.checkTimer);
		window.checkTimer = null;
	}
	if (localStorage.checkInterval * 1) {
		window.checkTimer = setInterval(runBackgroundUpdate, localStorage.checkInterval * 1000);
	} else {
		setBadge('');
	}
}
function submitItem(data, callback, badCallback) {
	lastSubmittedData = data;
	var service = localStorage.defaultService;
	if (service === 'pocket') {
		var method = 'POST';
		var xhrData = new XhrDataObj('pocket', data);
	}
	doXHR({
		method    : method,
		url       : services[service].endpoints['add'],
		data      : xhrData,
		onSuccess : callback,
		onFailure : badCallback
	});
}
function tagIsInFilter(iTag) {
	return this.some(function (fTag) {
		return iTag == fTag;
	});
}
function updateItems(since, callback, badCallback) {
	var downloadLimit = localStorage.downloadLimit * 1;
	(downloadLimit > 0) || (downloadLimit = defaults.downloadLimit * 1);
	(localStorage.reloadOnUpdate == 'yes') && (since = null);
	if (!since || !itemCache || !itemCache.length) {
		getItems(localStorage.defaultService, null, 'unread', downloadLimit, function (items) {
			// console.log('Unread items:', items);
			itemCache = items;
			if (items.length >= downloadLimit) {
				finishUpdatingItems(callback);
			} else {
				getItems(localStorage.defaultService, '', 'archive', downloadLimit - itemCache.length, function (items) {
					// console.log('Read items:', items);
					itemCache = itemCache.concat(items);
					finishUpdatingItems(callback);
				}, badCallback);
			}
		}, badCallback);
	} else {
		getItems(localStorage.defaultService, since, '', downloadLimit, function (items) {
			// console.log('New/updated items:', items);
			for (var i = items.length - 1; i >= 0; i--)
				replaceOrAdd(items[i]);
			finishUpdatingItems(callback);
		}, badCallback);
	}
}
function urlFitsPattern(pattern) {
	return reifyUrlPattern(pattern).test(this);
}
function urlMatchesRegExp(re) {
	return !!this.match(re);
}
function urlPatternStringToRegExpArray(patternString) {
	var patternArray = patternString.replace(/,/g, ' ').replace(/ +/g, ' ').split(' ');
	return patternArray.map(reifyUrlPattern);
}
