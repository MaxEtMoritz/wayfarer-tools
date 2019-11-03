// ==UserScript==
// @name         Wayfarer Exporter
// @version      0.3
// @description  Export nominations data from Wayfarer to IITC in Wayfarer Planner
// @namespace    https://gitlab.com/AlfonsoML/wayfarer/
// @downloadURL  https://gitlab.com/AlfonsoML/wayfarer/raw/master/wayfarer-exporter.user.js
// @homepageURL  https://gitlab.com/AlfonsoML/wayfarer/
// @match        https://wayfarer.nianticlabs.com/*
// ==/UserScript==

/* globals unsafeWindow */
/* eslint-env es6 */
/* eslint no-var: "error" */

function init() {
	const w = typeof unsafeWindow === 'undefined' ? window : unsafeWindow;
	let tryNumber = 15;

	let nominationController;

	const initWatcher = setInterval(() => {
		if (tryNumber === 0) {
			clearInterval(initWatcher);
			w.document.querySelector('body')
				.insertAdjacentHTML('afterBegin', `<div class='alert alert-danger'><strong><span class='glyphicon glyphicon-remove'></span> Wayfarer Exporter initialization failed, refresh page</strong></div>`);
			return;
		}
		if (w.angular) {
			initScript();
			clearInterval(initWatcher);
		}
		tryNumber--;
	}, 1000);


	function initScript() {
		const el = w.document.querySelector('.nominations-controller');
		if (!el) {
			//console.log('not in nominations');
			return;
		}

		nominationController = w.angular.element(el).scope().nomCtrl;

		if (nominationController !== null) {
			addConfigurationButton();

			analyzeCandidates();
		}
	}

	let currentCandidates;
	function analyzeCandidates() {
		if (!nominationController.loaded) {
			setTimeout(analyzeCandidates, 200);
			return;
		}

		const sentCandidates = nominationController.nomList;
		getAllCandidates()
			.then(function(candidates) {
				currentCandidates = candidates;
				let modifiedCandidates = false;
				sentCandidates.forEach(nomination => {
					if (checkNomination(nomination))
						modifiedCandidates = true;
				});
				if (modifiedCandidates) {
					localStorage['wayfarerexporter-candidates'] = JSON.stringify(currentCandidates);
				}
			});
	}

	/*
		returns true if it has modified the currentCandidates object and we must save it to localStorage after the loop ends
	*/
	function checkNomination(nomination) {
	//	console.log(nomination);
		const id = nomination.id;
		// if we're already tracking it...
		if (currentCandidates[id]) {
			if (nomination.status == 'ACCEPTED') {
				// Ok, we don't have to track it any longer.
				deleteCandidate(nomination);
			}
			if (nomination.status == 'REJECTED') {
				rejectCandidate(nomination);
			}
			if (nomination.status == 'DUPLICATE') {
				rejectCandidate(nomination);
			}
			if (nomination.status == 'WITHDRAWN') {
				rejectCandidate(nomination);
			}
			delete currentCandidates[id];
			return true
		} 

		if (nomination.status == 'NOMINATED' || nomination.status == 'VOTING') {
			/*
			Try to find nominations added manually in IITC:
			same name in the same level 17 cell
			*/
			const cell17 = S2.S2Cell.FromLatLng(nomination, 17);
			const cell17id = cell17.toString()
			Object.keys(currentCandidates).forEach(idx => {
				const candidate = currentCandidates[idx];
				if (candidate.title == nomination.title && candidate.cell17id == cell17id) {
					// if we find such candidate, remove it because we're gonna add now the new one with a new id
					console.log('Found manual candidate for ' + candidate.title);
					deleteCandidate({id: idx});
				}
			});

			addCandidate(nomination);
			currentCandidates[nomination.id] = {
				lat: nomination.lat,
				lng: nomination.lng,
				title: nomination.title
			};
			return true;
		}
		return false;
	}


	function addCandidate(nomination) {
		console.log('Tracking new nomination', nomination);
		updateStatus(nomination, 'submitted'); 
	}

	function deleteCandidate(nomination) {
		console.log('Deleting nomination', nomination);
		updateStatus(nomination, 'delete'); 
	}

	function rejectCandidate(nomination) {
		console.log('Rejected nomination', nomination);
		updateStatus(nomination, 'rejected'); 
	}

	function updateStatus(nomination, newStatus) {
		const formData = new FormData();
		formData.append('status', newStatus);
		formData.append('id', nomination.id);
		formData.append('lat', nomination.lat);
		formData.append('lng', nomination.lng);
		formData.append('title', nomination.title);
		formData.append('description', nomination.description);
		formData.append('submitteddate', nomination.day);
		formData.append('candidateimageurl', nomination.imageUrl);

		formData.append('nickname', 'wayfarer'); // fixme: get player

		const options = {
			method: 'POST',
			body: formData
		};

		fetch(getUrl(), options)
			.then(data => {}) 
			.catch(error => {
				console.log('Catched fetch comment error', error); // eslint-disable-line no-console
				alert(error);
			}); 
	}

	function getUrl() {
		return localStorage['wayfarerexporter-url'];
	}

	function addConfigurationButton() {
		const link = document.createElement('a');
		link.className = 'sidebar-item sidebar-wayfarerexporter';
		link.title = 'Configure Exporter';
		link.style.paddingLeft = '27px';
		link.innerHTML = '<span class="glyphicon glyphicon-share"></span> Exporter';
		const ref = document.querySelector('.sidebar-nominations');

		ref.parentNode.appendChild(link);

		link.addEventListener('click', function(e) {
			e.preventDefault();

			const currentUrl = getUrl();
			const url = window.prompt('Script Url for Wayfarer Planner', currentUrl);
			if (!url)
				return;

			loadPlannerData(url)
				.then(analyzeCandidates);
		});
	}

	function getAllCandidates() {
		const promesa = new Promise(function (resolve, reject) {

			const storedData = localStorage['wayfarerexporter-candidates'];
			const lastUpdate = localStorage['wayfarerexporter-lastupdate'] || 0;
			const now = (new Date()).getTime();
			// cache it for 12 hours
			if (!storedData || (now - lastUpdate) > 12 * 60 * 60 * 1000) {
				resolve(loadPlannerData());
				return;
			}
			resolve(JSON.parse(storedData));
		});

		return promesa;
	}

	function loadPlannerData(newUrl) {
		let url = newUrl || getUrl();
		if (!url) {
			url = window.prompt('Script Url for Wayfarer Planner');
			if (!url)
				return null;
		}
		const fetchOptions = {
			method: 'GET'
		};

		return fetch(url, fetchOptions)
			.then(function (response) {return response.text();})
			.then(function (data) {return JSON.parse(data);})
			.then(function (allData) {
				const submitted = allData.filter(c => (c.status == 'submitted' || c.status == 'potential' || c.status == 'rejected'));

				const candidates = {};
				submitted.forEach( c => {
					const cell17 = S2.S2Cell.FromLatLng(c, 17);
					candidates[c.id] = {
						cell17id: cell17.toString(),
						title: c.title
					};
				})
				localStorage['wayfarerexporter-url'] = url;
				localStorage['wayfarerexporter-lastupdate'] = (new Date()).getTime();
				localStorage['wayfarerexporter-candidates'] = JSON.stringify(candidates);

				return candidates;
			})
			.catch(function(e) {
				console.log(e); // eslint-disable-line no-console
				alert(e);
			});
	}


/** 
 S2 extracted from Regions Plugin
 https:static.iitc.me/build/release/plugins/regions.user.js
*/
	const S2 = {};
	const d2r = Math.PI / 180.0;

	function LatLngToXYZ(latLng) {
		const phi = latLng.lat * d2r;
		const theta = latLng.lng * d2r;
		const cosphi = Math.cos(phi);

		return [Math.cos(theta) * cosphi, Math.sin(theta) * cosphi, Math.sin(phi)];
	}

	function largestAbsComponent(xyz) {
		const temp = [Math.abs(xyz[0]), Math.abs(xyz[1]), Math.abs(xyz[2])];

		if (temp[0] > temp[1]) {
			if (temp[0] > temp[2]) {
				return 0;
			} 
			return 2;
		} 

		if (temp[1] > temp[2]) {
			return 1;
		} 

		return 2;
	}

	function faceXYZToUV(face,xyz) {
		let u, v;

		switch (face) {
			case 0: u =	xyz[1] / xyz[0];	v = xyz[2] / xyz[0]; break;
			case 1: u = -xyz[0] / xyz[1];	v = xyz[2] / xyz[1]; break;
			case 2: u = -xyz[0] / xyz[2];	v = -xyz[1] / xyz[2]; break;
			case 3: u =	xyz[2] / xyz[0];	v = xyz[1] / xyz[0]; break;
			case 4: u =	xyz[2] / xyz[1];	v = -xyz[0] / xyz[1]; break;
			case 5: u = -xyz[1] / xyz[2];	v = -xyz[0] / xyz[2]; break;
			default: throw {error: 'Invalid face'}; 
		}

		return [u, v];
	}

	function XYZToFaceUV(xyz) {
		let face = largestAbsComponent(xyz);

		if (xyz[face] < 0) {
			face += 3;
		}

		const uv = faceXYZToUV(face, xyz);

		return [face, uv];
	}

	function UVToST(uv) {
		const singleUVtoST = function (uv) {
			if (uv >= 0) {
				return 0.5 * Math.sqrt (1 + 3 * uv);
			} 
			return 1 - 0.5 * Math.sqrt (1 - 3 * uv);
			
		};

		return [singleUVtoST(uv[0]), singleUVtoST(uv[1])];
	}

	function STToIJ(st,order) {
		const maxSize = 1 << order;

		const singleSTtoIJ = function (st) {
			const ij = Math.floor(st * maxSize);
			return Math.max(0, Math.min(maxSize - 1, ij));
		};

		return [singleSTtoIJ(st[0]), singleSTtoIJ(st[1])];
	}

	// S2Cell class
	S2.S2Cell = function () {};

	//static method to construct
	S2.S2Cell.FromLatLng = function (latLng, level) {
		const xyz = LatLngToXYZ(latLng);
		const faceuv = XYZToFaceUV(xyz);
		const st = UVToST(faceuv[1]);
		const ij = STToIJ(st,level);

		return S2.S2Cell.FromFaceIJ(faceuv[0], ij, level);
	};

	S2.S2Cell.FromFaceIJ = function (face, ij, level) {
		const cell = new S2.S2Cell();
		cell.face = face;
		cell.ij = ij;
		cell.level = level;

		return cell;
	};

	S2.S2Cell.prototype.toString = function () {
		return 'F' + this.face + 'ij[' + this.ij[0] + ',' + this.ij[1] + ']@' + this.level;
	};

}

init();



