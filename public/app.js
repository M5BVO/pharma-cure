document.addEventListener('DOMContentLoaded', () => {
    // --- GLOBAL ERROR TRACKING ---
    window.onerror = function(message, source, lineno, colno, error) {
        console.error('Pharma-Cure Error:', message, error);
        if (window.showToast) window.showToast('System Error: ' + message, 'error');
        return false;
    };

    let currentUser = null;
    try {
        const storedUser = localStorage.getItem('user');
        currentUser = storedUser ? JSON.parse(storedUser) : null;
    } catch (e) {
        console.error('Auth state corrupted, resetting...');
        localStorage.clear();
    }

    let token = localStorage.getItem('token') || null;
    let selectedPharmacyID = localStorage.getItem('selectedPharmacyID');
    if (selectedPharmacyID === 'null' || selectedPharmacyID === 'undefined') selectedPharmacyID = null;
    let currentModule = null;
    let notificationInterval = null;

    // --- TOAST NOTIFICATION SYSTEM ---
    window.showToast = (message, type = 'info') => {
        let container = document.getElementById('toastContainer');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toastContainer';
            container.className = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = { success: '✓', error: '!', info: 'i' };
        toast.innerHTML = `
            <div style="display:flex; align-items:center; gap:0.8rem;">
                <span style="font-size:1.2rem;">[i]</span>
                <span style="font-size:0.95rem; font-weight:600;">${message}</span>
            </div>
            <span style="cursor:pointer; opacity:0.5; font-size:1.2rem;" onclick="this.parentElement.remove()">X</span>
        `;
        container.appendChild(toast);

        // Auto-remove after 5 seconds
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 400);
        }, 5000);
    };

    window.undoStack = [];
    window.pushUndo = (action) => {
        window.undoStack.push(action);
        window.renderUndoBanner();
    };

    window.renderUndoBanner = () => {
        let banner = document.getElementById('undoBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'undoBanner';
            document.body.appendChild(banner);
        }
        
        if (window.undoStack.length === 0) {
            banner.style.display = 'none';
            return;
        }

        banner.className = 'undo-banner';
        const lastAction = window.undoStack[window.undoStack.length - 1];
        banner.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 0.2rem;">
                <span style="font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.5px;">Recent Action</span>
                <strong style="color: var(--text-main); font-size: 0.9rem;">${lastAction.description}</strong>
            </div>
            <button class="btn-primary" style="margin: 0; padding: 0.5rem 1rem; font-size: 0.8rem; background: linear-gradient(45deg, var(--primary-blue), var(--secondary-teal));" onclick="window.triggerUndo()">Undo Action</button>
        `;
        banner.style.display = 'flex';
    };

    window.triggerUndo = async () => {
        if (window.undoStack.length === 0) return;
        const lastAction = window.undoStack.pop();
        window.renderUndoBanner();
        try {
            await lastAction.undo();
            window.showToast('Action undone successfully.', 'success');
        } catch (err) {
            console.error(err);
            window.showToast('Failed to undo the action.', 'error');
        }
    };

    const UI = {
        landingPage: document.getElementById('landingPage'),
        loginPage: document.getElementById('loginPage'),
        registerPage: document.getElementById('registerPage'),
        mainApp: document.getElementById('mainApp'),
        mainNav: document.getElementById('mainNav'),
        contentArea: document.getElementById('contentArea'),
        userStatus: document.getElementById('userStatus'),
        roleSelect: document.getElementById('roleSelect')
    };

    // Guard against script crashes if HTML structure is incomplete
    const guardListener = (id, event, callback) => {
        const el = document.getElementById(id);
        if (el) el.addEventListener(event, callback);
    };

    const api = {
        get: async (url) => {
            const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
            if (!res.ok) throw new Error('API GET Failed');
            return res.json();
        },
        post: async (url, data, isMultipart = false) => {
            const headers = { 'Authorization': `Bearer ${token}` };
            if (!isMultipart) headers['Content-Type'] = 'application/json';
            return fetch(url, { method: 'POST', headers, body: isMultipart ? data : JSON.stringify(data) });
        },
        put: async (url, data) => {
            return fetch(url, { 
                method: 'PUT', 
                headers: { 
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}` 
                }, 
                body: JSON.stringify(data) 
            });
        },
        patch: async (url, data) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify(data) }),
        delete: async (url) => fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } })
    };

    window.showPage = (page, pushToHistory = true) => {
        [UI.landingPage, UI.loginPage, UI.registerPage, UI.mainApp].forEach(p => {
            if (p) p.style.display = 'none';
        });
        if (UI[page]) {
            if (page === 'mainApp') UI[page].style.display = 'flex';
            else UI[page].style.display = 'block';
        }
        window.scrollTo(0, 0);

        if (pushToHistory) {
            history.pushState({ page, type: 'view' }, '', `#${page}`);
        }
    };

    // --- LANDING PAGE ACTIONS ---
    window.scrollToPortals = () => {
        document.getElementById('portalSection').scrollIntoView({ behavior: 'smooth' });
    };

    window.scrollToExplore = () => {
        document.getElementById('exploreSection').scrollIntoView({ behavior: 'smooth' });
    };

    window.openPortal = (role) => {
        if (UI.roleSelect) {
            UI.roleSelect.value = role;
            UI.roleSelect.dispatchEvent(new Event('change'));
        }
        const title = document.getElementById('loginPortalTitle');
        if (title) title.innerText = `${role.charAt(0).toUpperCase() + role.slice(1)} Portal Login`;
        showPage('loginPage');
    };

    // --- NOTIFICATION POLLING ---
    const updateNotifUI = (notifs) => {
        const badge = document.getElementById('notifBadge');
        const list = document.getElementById('notifList');
        if (!badge || !list) return;

        if (notifs.length > 0) {
            badge.innerText = notifs.length;
            badge.style.display = 'flex';
            list.innerHTML = notifs.map(n => `
                <div class="notif-item" onclick="navigateToNotif('${n.link}')">
                    <p>${n.message}</p>
                </div>
            `).join('');
        } else {
            badge.style.display = 'none';
            list.innerHTML = '<p class="no-notifs">No notifications</p>';
        }
    };

    const startNotificationPolling = () => {
        if (notificationInterval) clearInterval(notificationInterval);
        const poll = async () => {
            if (!token) return;
            try {
                const notifs = await api.get('/api/notifications');
                updateNotifUI(notifs);
            } catch (err) {
                console.error('Notification fetch failed', err);
            }
        };
        poll();
        notificationInterval = setInterval(poll, 10000);
    };

    const stopNotificationPolling = () => {
        if (notificationInterval) {
            clearInterval(notificationInterval);
            notificationInterval = null;
        }
    };

    window.navigateToNotif = (moduleName) => {
        loadModule(moduleName);
        const dropdown = document.getElementById('notifDropdown');
        if (dropdown) dropdown.style.display = 'none';
    };

    // Notification dropdown toggle
    const notifBellBtn = document.getElementById('notifBellBtn');
    const notifDropdown = document.getElementById('notifDropdown');
    if (notifBellBtn && notifDropdown) {
        notifBellBtn.onclick = (e) => {
            e.stopPropagation();
            notifDropdown.style.display = notifDropdown.style.display === 'block' ? 'none' : 'block';
        };
    }
    document.addEventListener('click', (e) => {
        if (notifDropdown && notifDropdown.style.display === 'block') {
            if (!notifDropdown.contains(e.target) && e.target !== notifBellBtn && !notifBellBtn.contains(e.target)) {
                notifDropdown.style.display = 'none';
            }
        }
    });

    // --- AUTH ---
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        const originalText = btn.innerText;
        btn.innerText = 'Verifying...';
        btn.disabled = true;

        try {
            const res = await api.post('/api/auth/login', { username: document.getElementById('loginUsername').value, password: document.getElementById('loginPassword').value });
            const data = await res.json();
            if (res.ok) {
                window.showToast('Access Granted. Initializing Secure Session...', 'success');
                token = data.token; currentUser = { username: data.username, role: data.role };
                localStorage.setItem('token', token); localStorage.setItem('user', JSON.stringify(currentUser));
                setTimeout(() => initApp(), 800);
            } else {
                window.showToast(data.error, 'error');
                btn.innerText = originalText;
                btn.disabled = false;
            }
        } catch (err) { 
            window.showToast('System Connection Failure', 'error');
            btn.innerText = originalText;
            btn.disabled = false;
        }
    });

    document.getElementById('registerForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await api.post('/api/auth/register', new FormData(e.target), true);
        const data = await res.json();
        window.showToast(data.message || data.error, res.ok ? 'success' : 'error');
        if (res.ok) showPage('loginPage');
    });

    guardListener('roleSelect', 'change', () => {
        const role = UI.roleSelect.value;
        document.querySelectorAll('.pharmacist-only').forEach(el => el.style.display = role === 'pharmacist' ? 'block' : 'none');
        document.querySelectorAll('.patient-only').forEach(el => el.style.display = role === 'patient' ? 'block' : 'none');
    });

    const logout = () => { 
        stopNotificationPolling();
        window.undoStack = [];
        window.renderUndoBanner();
        localStorage.clear(); 
        token = null; 
        currentUser = null; 
        selectedPharmacyID = null; 
        window.showPage('landingPage'); 
    };

    guardListener('logoutBtn', 'click', logout);
    guardListener('toRegister', 'click', () => window.showPage('registerPage'));
    guardListener('toLogin', 'click', () => window.showPage('loginPage'));

    // --- VISUAL SVG CHART RENDERERS ---
    const drawLineChart = (data, options = {}) => {
        const width = options.width || 600;
        const height = options.height || 220;
        const padding = { top: 20, right: 30, bottom: 40, left: 50 };
        
        if (!data || data.length === 0) {
            return `<div class="chart-placeholder">No analytical trend data available.</div>`;
        }

        const maxVal = Math.max(...data.map(d => Number(d.yValue) || 0), 10) * 1.1;
        const minVal = 0;
        
        let grids = '';
        const gridSteps = 4;
        for (let i = 0; i <= gridSteps; i++) {
            const val = minVal + (maxVal - minVal) * (i / gridSteps);
            const y = padding.top + (height - padding.top - padding.bottom) * (1 - (i / gridSteps));
            grids += `
                <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(0,0,0,0.05)" stroke-dasharray="4" />
                <text x="${padding.left - 10}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">$${val.toFixed(2)}</text>
            `;
        }

        const points = data.map((d, index) => {
            const x = padding.left + (width - padding.left - padding.right) * (index / Math.max(data.length - 1, 1));
            const ratio = maxVal > 0 ? (Number(d.yValue) || 0) / maxVal : 0;
            const y = padding.top + (height - padding.top - padding.bottom) * (1 - ratio);
            return { x, y, label: d.xLabel, val: Number(d.yValue) || 0 };
        });

        let pathD = '';
        let areaD = '';
        if (points.length > 0) {
            pathD = `M ${points[0].x} ${points[0].y} ` + points.slice(1).map(p => `L ${p.x} ${p.y}`).join(' ');
            areaD = pathD + ` L ${points[points.length - 1].x} ${height - padding.bottom} L ${points[0].x} ${height - padding.bottom} Z`;
        }

        let dots = '';
        let xLabels = '';
        points.forEach((p, idx) => {
            dots += `
                <g class="chart-point-group">
                    <circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--primary-blue)" stroke="var(--surface-white)" stroke-width="2" />
                    <circle cx="${p.x}" cy="${p.y}" r="8" fill="rgba(0, 91, 150, 0.2)" opacity="0" class="hover-glow" />
                    <rect x="${p.x - 35}" y="${p.y - 30}" width="70" height="20" rx="3" fill="var(--text-main)" stroke="var(--primary-blue)" stroke-width="1" class="chart-tooltip" />
                    <text x="${p.x}" y="${p.y - 17}" fill="white" font-size="9" text-anchor="middle" font-weight="bold" class="chart-tooltip-text">$${p.val.toFixed(2)}</text>
                </g>
            `;
            const showLabel = points.length < 10 || idx % 2 === 0;
            if (showLabel) {
                const shortLabel = p.label.includes('-') ? p.label.split('-').slice(1).join('/') : p.label;
                xLabels += `<text x="${p.x}" y="${height - padding.bottom + 18}" fill="rgba(255,255,255,0.5)" font-size="10" text-anchor="middle">${shortLabel}</text>`;
            }
        });

        return `
            <svg viewBox="0 0 ${width} ${height}" class="line-chart-svg" style="width:100%; height:auto;">
                <defs>
                    <linearGradient id="chartGlow" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stop-color="var(--primary-blue)" stop-opacity="0.3"/>
                        <stop offset="100%" stop-color="var(--primary-blue)" stop-opacity="0.0"/>
                    </linearGradient>
                </defs>
                ${grids}
                ${areaD ? `<path d="${areaD}" fill="url(#chartGlow)" />` : ''}
                ${pathD ? `<path d="${pathD}" fill="none" stroke="var(--primary-blue)" stroke-width="3" filter="drop-shadow(0px 0px 4px var(--primary-blue))" />` : ''}
                ${xLabels}
                ${dots}
            </svg>
        `;
    };

    const drawBarChart = (data, options = {}) => {
        const width = options.width || 600;
        const height = options.height || 220;
        const padding = { top: 20, right: 30, bottom: 40, left: 60 };
        
        if (!data || data.length === 0) {
            return `<div class="chart-placeholder">No category breakdown data available.</div>`;
        }

        const maxVal = Math.max(...data.map(d => Number(d.value) || 0), 10) * 1.1;
        
        let grids = '';
        const gridSteps = 4;
        for (let i = 0; i <= gridSteps; i++) {
            const val = (maxVal * (i / gridSteps));
            const y = padding.top + (height - padding.top - padding.bottom) * (1 - (i / gridSteps));
            grids += `
                <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="rgba(0,0,0,0.05)" stroke-dasharray="4" />
                <text x="${padding.left - 10}" y="${y + 4}" fill="var(--text-muted)" font-size="10" text-anchor="end">$${val.toFixed(2)}</text>
            `;
        }

        const barCount = data.length;
        const chartInnerWidth = width - padding.left - padding.right;
        const barWidth = Math.min((chartInnerWidth / barCount) * 0.5, 40);
        const barSpacing = chartInnerWidth / barCount;

        let bars = '';
        let xLabels = '';

        data.forEach((d, idx) => {
            const x = padding.left + (idx * barSpacing) + (barSpacing - barWidth) / 2;
            const ratio = maxVal > 0 ? (Number(d.value) || 0) / maxVal : 0;
            const barHeight = (height - padding.top - padding.bottom) * ratio;
            const y = height - padding.bottom - barHeight;

            const colorHue = (idx * (360 / Math.max(barCount, 1))) % 360;
            const barColor = `hsl(${colorHue}, 100%, 60%)`;

            bars += `
                <g class="chart-bar-group">
                    <rect x="${x}" y="${y}" width="${barWidth}" height="${Math.max(barHeight, 1)}" rx="3" fill="${barColor}" opacity="0.85" filter="drop-shadow(0px 0px 3px ${barColor})" />
                    <rect x="${x - 20}" y="${y - 30}" width="${barWidth + 40}" height="20" rx="3" fill="var(--text-main)" stroke="${barColor}" stroke-width="1" class="chart-tooltip" />
                    <text x="${x + barWidth / 2}" y="${y - 17}" fill="white" font-size="9" text-anchor="middle" font-weight="bold" class="chart-tooltip-text">$${(Number(d.value) || 0).toFixed(2)} (${d.totalCount} sales)</text>
                </g>
            `;

            xLabels += `
                <text x="${x + barWidth / 2}" y="${height - padding.bottom + 18}" fill="rgba(255,255,255,0.5)" font-size="9" text-anchor="middle" class="bar-x-label">${d.label}</text>
            `;
        });

        return `
            <svg viewBox="0 0 ${width} ${height}" class="bar-chart-svg" style="width:100%; height:auto;">
                ${grids}
                ${bars}
                ${xLabels}
            </svg>
        `;
    };

    // --- APP CORE ---
    const initApp = () => {
        showPage('mainApp');
        UI.userStatus.innerHTML = `
            <div style="display:flex; flex-direction:column; align-items:flex-end;">
                <span style="font-size:0.9rem;">${currentUser.username}</span>
                <span style="font-size:0.65rem; color:var(--text-muted); text-transform:uppercase;">${currentUser.role}</span>
            </div>
            <div style="width:32px; height:32px; background:var(--bg-clinical); border-radius:50%; display:flex; align-items:center; justify-content:center; border:1px solid var(--border-soft); font-size:0.8rem; font-weight:900; color:var(--primary-blue);">${currentUser.username.charAt(0).toUpperCase()}</div>
        `;
        renderNav();

        const notifContainer = document.querySelector('.notification-container');
        if (notifContainer) {
            notifContainer.style.display = currentUser.role === 'admin' ? 'block' : 'none';
        }

        if (currentUser.role === 'admin') {
            startNotificationPolling();
        } else {
            stopNotificationPolling();
        }

        const start = { 
            admin: 'admin_users', 
            patient: 'patient_dashboard', 
            pharmacist: 'my_pharmacies',
            supplier: 'supplier_dashboard'
        };
        loadModule(start[currentUser.role]);
    };

    const renderNav = () => {
        const links = {
            admin: [
                { id: 'admin_registry', label: 'User Registry' },
                { id: 'admin_users', label: 'Verify Pharmacists' },
                { id: 'admin_suppliers', label: 'Verify Suppliers' },
                { id: 'admin_pharma', label: 'Verify Pharma' },
                { id: 'medicines', label: 'Medicines' },
                { id: 'complaints', label: 'Complaints' }
            ],
            pharmacist: [
                { id: 'my_pharmacies', label: 'My Pharmacies' },
                { id: 'dashboard', label: 'Analytics' },
                { id: 'inventory', label: 'Stock Control' },
                { id: 'proposals', label: 'Proposals' },
                { id: 'complaints', label: 'Complaints' },
                { id: 'suggest_pharma', label: 'Suggest New' }
            ],
            patient: [
                { id: 'patient_dashboard', label: 'Dashboard' },
                { id: 'myRecords', label: 'Identity & Profile' },
                { id: 'proposals', label: 'My Proposals' }
            ],
            supplier: [
                { id: 'supplier_dashboard', label: 'Dashboard' },
                { id: 'supplier_stock', label: 'My Stock' },
                { id: 'proposals', label: 'Network Proposals' }
            ]
        };
        UI.mainNav.innerHTML = links[currentUser.role].map(l => `<a class="sidebar-link" data-module="${l.id}">${l.label}</a>`).join('');
        document.querySelectorAll('.sidebar-link').forEach(l => l.addEventListener('click', () => loadModule(l.dataset.module)));
    };

    // --- GEOLOCATION HELPER ---
    window.initCoordinatePicker = (targetIdLat, targetIdLng) => {
        const picker = document.createElement('div');
        picker.style.cssText = 'height:200px; background:#eef2f3; border-radius:12px; display:flex; align-items:center; justify-content:center; cursor:pointer; margin-top:1rem; border:2px dashed var(--border-soft);';
        picker.innerHTML = '<div style="text-align:center;"><p style="font-weight:700; color:var(--primary-blue);">INTERACTIVE MAP INTERFACE</p><p style="font-size:0.8rem; color:var(--text-muted);">Click to simulate coordinate extraction</p></div>';
        picker.onclick = () => {
            const lat = (33.5 + Math.random()).toFixed(6);
            const lng = (36.2 + Math.random()).toFixed(6);
            document.getElementById(targetIdLat).value = lat;
            document.getElementById(targetIdLng).value = lng;
            window.showToast(`Coordinates captured: ${lat}, ${lng}`, 'info');
        };
        return picker;
    };

    const getExpiryStatusHTML = (expiryDateStr) => {
        if (!expiryDateStr) return '<span class="expiry-status valid">No Expiry Info</span>';
        const exp = new Date(expiryDateStr);
        const today = new Date();
        exp.setHours(0,0,0,0);
        today.setHours(0,0,0,0);
        const diffTime = exp - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
            return `<span class="expiry-status expired">Expired (${Math.abs(diffDays)} days ago)</span>`;
        } else if (diffDays <= 30) {
            return `<span class="expiry-status expiring-soon">Expiring in ${diffDays} days</span>`;
        } else {
            return `<span class="expiry-status valid">Valid (Expires ${expiryDateStr.split('T')[0]})</span>`;
        }
    };

    window.loadModule = async (moduleId, pushToHistory = true) => {
        currentModule = moduleId;
        document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`[data-module="${moduleId}"]`);
        if (activeLink) {
            activeLink.classList.add('active');
            document.getElementById('currentModuleTitle').innerText = activeLink.innerText.replace(/[^\x00-\x7F]/g, "").trim();
        }

        if (pushToHistory) {
            history.pushState({ moduleId, type: 'module' }, '', `#app/${moduleId}`);
        }

        UI.contentArea.style.opacity = '0';
        UI.contentArea.innerHTML = '<p style="text-align:center; padding: 2rem;">Retrieving secure data...</p>';

        try {
            let html = '';
            
            // PHARMACIST CHECK
            if (currentUser.role === 'pharmacist' && ['dashboard', 'inventory', 'orders'].includes(moduleId) && !selectedPharmacyID) {
                html = '<section><h2>Selection Required</h2><p>Please select a pharmacy from the "My Pharmacies" tab first.</p></section>';
            } 
            
            // ADMIN MODULES
            else if (moduleId === 'admin_registry') {
                const users = await api.get('/api/admin/users');
                html = `
                    <section>
                        <h2>System User Registry</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Username</th>
                                        <th>Role</th>
                                        <th>Email</th>
                                        <th>Status</th>
                                        <th style="width: 180px; text-align: center;">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${users.map(u => `
                                        <tr id="user-row-${u.userID}">
                                            <td><strong>${u.username}</strong></td>
                                            <td>${u.role.toUpperCase()}</td>
                                            <td>${u.email || 'N/A'}</td>
                                            <td><span class="status-tag">${u.status.toUpperCase()}</span></td>
                                            <td style="text-align: center;">
                                                ${u.userID === currentUser.userID ? '<span style="font-size: 0.8rem; color: var(--text-muted);">Current Admin</span>' : `
                                                    <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin: 0 0.3rem 0 0; background: linear-gradient(45deg, var(--primary-blue), var(--secondary-teal));" onclick="window.startEditUser(${u.userID}, '${u.username.replace(/'/g, "\\'")}', '${(u.email || '').replace(/'/g, "\\'")}', '${u.role}', '${u.status}')">Edit</button>
                                                    <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin:0; background:red" onclick="window.deleteUser(${u.userID})">Delete</button>
                                                `}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            } else if (moduleId === 'admin_users') {
                const users = await api.get('/api/admin/pending-users');
                if (users.length === 0) {
                    html = '<section><h2>Verification Queue</h2><p>No pending pharmacists at this time.</p></section>';
                } else {
                    html = `<section><h2>Pending Pharmacist Verifications</h2><div class="table-container"><table><thead><tr><th>User</th><th>Documents</th><th>Action</th></tr></thead><tbody>${users.map(u => `<tr><td>${u.username}</td><td><a href="/${u.degree_path}" target="_blank" style="color:var(--primary-blue)">Degree</a> | <a href="/${u.cv_path}" target="_blank" style="color:var(--primary-blue)">CV</a></td><td><button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin-right:0.5rem" onclick="verifyUser(${u.userID}, 'approved')">Approve</button> <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; background:red" onclick="verifyUser(${u.userID}, 'rejected')">Reject</button></td></tr>`).join('')}</tbody></table></div></section>`;
                }
            } else if (moduleId === 'admin_suppliers') {
                const suppliers = await api.get('/api/admin/pending-suppliers');
                if (suppliers.length === 0) {
                    html = '<section><h2>Supplier Queue</h2><p>No pending suppliers at this time.</p></section>';
                } else {
                    html = `<section><h2>Pending Supplier Verifications</h2><div class="table-container"><table><thead><tr><th>User</th><th>Email</th><th>Action</th></tr></thead><tbody>${suppliers.map(s => `<tr><td>${s.username}</td><td>${s.email || 'N/A'}</td><td><button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin-right:0.5rem" onclick="verifyUser(${s.userID}, 'approved')">Approve</button> <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; background:red" onclick="verifyUser(${s.userID}, 'rejected')">Reject</button></td></tr>`).join('')}</tbody></table></div></section>`;
                }
            } else if (moduleId === 'admin_pharma') {
                const pharma = await api.get('/api/admin/pending-pharmacies');
                if (pharma.length === 0) {
                    html = '<section><h2>Pharma Suggestions</h2><p>No new pharmacy suggestions to review.</p></section>';
                } else {
                    html = `<section><h2>Verify Suggestions</h2><div class="table-container"><table><thead><tr><th>Name</th><th>Owner</th><th>Action</th></tr></thead><tbody>${pharma.map(p => `<tr><td>${p.name}</td><td>${p.owner_name}</td><td><button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin-right:0.5rem" onclick="verifyPharma(${p.pharmacyID}, 'approved')">Accept</button> <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; background:red" onclick="verifyPharma(${p.pharmacyID}, 'rejected')">Reject</button></td></tr>`).join('')}</tbody></table></div></section>`;
                }
            }

            // PHARMACIST MODULES
            else if (moduleId === 'my_pharmacies') {
                const pharmacies = await api.get('/api/pharmacist/my-pharmacies');
                html = `<section><h2>Manage Your Entities</h2><div class="table-container"><table><thead><tr><th>Name</th><th>Status</th><th>Action</th></tr></thead><tbody>${pharmacies.map(p => `<tr style="${p.pharmacyID == selectedPharmacyID ? 'background:rgba(0,242,255,0.1)' : ''}"><td>${p.name}</td><td><span class="status-tag">${p.status.toUpperCase()}</span></td><td>${p.status === 'approved' ? `<button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem" onclick="selectPharmacy(${p.pharmacyID})">Select</button>` : ''} <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; background:red; margin-left:0.5rem" onclick="deletePharmacy(${p.pharmacyID})">Delete</button></td></tr>`).join('')}</tbody></table></div></section>`;
            } else if (moduleId === 'dashboard') {
                const stats = await api.get(`/api/pharmacist/stats/${selectedPharmacyID}`);
                
                const totalGains = Number(stats.totalGains) || 0;
                const totalSalesCount = Number(stats.totalSalesCount) || 0;
                const avgOrderValue = Number(stats.avgOrderValue) || 0;
                const totalInventoryValue = Number(stats.totalInventoryValue) || 0;
                
                html = `
                    <div class="dashboard-container">
                        <h2>Analytics Dashboard // Pharmacy Insights</h2>
                        
                        <div class="metrics-grid">
                            <div class="stat-card">
                                <h3>Total Earnings (Revenue)</h3>
                                <p class="stat-value text-success">$${totalGains.toFixed(2)}</p>
                            </div>
                            <div class="stat-card">
                                <h3>Sales Fulfillments</h3>
                                <p class="stat-value text-blue">${totalSalesCount} sales</p>
                            </div>
                            <div class="stat-card">
                                <h3>Average Sale Value</h3>
                                <p class="stat-value">$${avgOrderValue.toFixed(2)}</p>
                            </div>
                            <div class="stat-card">
                                <h3>Total Inventory Value</h3>
                                <p class="stat-value text-purple">$${totalInventoryValue.toFixed(2)}</p>
                            </div>
                        </div>

                        <div class="dashboard-row">
                            <div class="card chart-card">
                                <h3>7-Day Sales Trend (Revenue)</h3>
                                <div class="chart-container">
                                    ${drawLineChart(stats.salesHistory.map(s => ({ xLabel: s.date, yValue: s.revenue })))}
                                </div>
                            </div>
                            <div class="card chart-card">
                                <h3>Category Breakdown (Sales Revenue)</h3>
                                <div class="chart-container">
                                    ${drawBarChart(stats.categoryBreakdown.map(c => ({ label: c.category, value: c.revenue, totalCount: c.count })))}
                                </div>
                            </div>
                        </div>

                        <div class="dashboard-row bottom-row">
                            <div class="card alert-card">
                                <h3>Inventory Security & Alerts</h3>
                                
                                <h4 class="alert-section-title expiring-soon">Expiring Soon (Next 30 Days)</h4>
                                ${stats.expiringList && stats.expiringList.length > 0 ? `
                                    <div class="alert-list-container">
                                        <ul class="alert-list">
                                            ${stats.expiringList.map(item => {
                                                const isExpired = item.days_left <= 0;
                                                const badgeClass = isExpired ? 'badge-danger' : 'badge-warning';
                                                const badgeText = isExpired ? `Expired (${Math.abs(item.days_left)} days ago)` : `${item.days_left} days left`;
                                                const alertClass = isExpired ? 'danger' : 'warn';
                                                return `
                                                    <li class="alert-item ${alertClass}" style="display: flex; justify-content: space-between; align-items: center;">
                                                        <span><strong>${item.name}</strong> (${item.quantity} left)</span>
                                                        <div style="display: flex; align-items: center; gap: 0.5rem;">
                                                            <span class="badge ${badgeClass}">${badgeText}</span>
                                                            <button class="btn-primary-mini" style="background: red; border-color: red; padding: 0.2rem 0.5rem; font-size: 0.75rem;" onclick="window.disposeMedicine(${selectedPharmacyID}, ${item.medicineID})">Dispose</button>
                                                        </div>
                                                    </li>
                                                `;
                                            }).join('')}
                                        </ul>
                                    </div>
                                ` : `<p class="no-alerts-msg">No immediate expiration concerns.</p>`}
                                
                                <h4 class="alert-section-title low-stock" style="margin-top: 1.5rem;">Low Stock Level (<= 10 units)</h4>
                                ${stats.lowStockList && stats.lowStockList.length > 0 ? `
                                    <div class="alert-list-container">
                                        <ul class="alert-list">
                                            ${stats.lowStockList.map(item => `
                                                <li class="alert-item danger">
                                                    <span><strong>${item.name}</strong> (Only ${item.quantity} units)</span>
                                                    <button class="btn-primary-mini" onclick="loadModule('inventory')">Purchase Supply</button>
                                                </li>
                                            `).join('')}
                                        </ul>
                                    </div>
                                ` : `<p class="no-alerts-msg">All stock levels within safe thresholds.</p>`}
                            </div>

                            <div class="card top-meds-card">
                                <h3>Top 5 Selling Medicines (By Value)</h3>
                                <div class="table-container">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Medicine Name</th>
                                                <th>Total Units Sold</th>
                                                <th>Total Revenue ($)</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${stats.topMeds && stats.topMeds.length > 0 ? stats.topMeds.map(m => `
                                                <tr>
                                                    <td><strong>${m.name}</strong></td>
                                                    <td>${m.sales} units</td>
                                                    <td>$${(Number(m.revenue) || 0).toFixed(2)}</td>
                                                </tr>
                                            `).join('') : '<tr><td colspan="3" style="text-align:center">No sales completed.</td></tr>'}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else if (moduleId === 'supplier_dashboard') {
                const stats = await api.get('/api/supplier/stats');
                html = `
                    <div class="dashboard-container">
                        <h2>Supplier Analytics // Control Center</h2>
                        
                        <div class="metrics-grid">
                            <div class="stat-card">
                                <h3>Total Processed Units</h3>
                                <p class="stat-value text-blue">${stats.totalUnits} units</p>
                            </div>
                            <div class="stat-card">
                                <h3>Total Orders Count</h3>
                                <p class="stat-value">${stats.totalOrders} orders</p>
                            </div>
                            <div class="stat-card">
                                <h3>Active Orders (Ordered)</h3>
                                <p class="stat-value text-warning">${stats.activeOrders} pending</p>
                            </div>
                            <div class="stat-card" style="border-color:${stats.lowStockCount > 0 ? '#ff9f0a' : 'var(--border-soft)'}">
                                <h3>Low Supply Items (<=50)</h3>
                                <p class="stat-value text-danger">${stats.lowStockCount} items</p>
                            </div>
                        </div>

                        <div class="dashboard-row">
                            <div class="card chart-card">
                                <h3>7-Day Dispatch Trend (Units Sent)</h3>
                                <div class="chart-container">
                                    ${drawLineChart(stats.dispatchHistory.map(d => ({ xLabel: d.date, yValue: d.units })))}
                                </div>
                            </div>
                            <div class="card chart-card">
                                <h3>Top Pharmacy Clients (Dispatched Volume)</h3>
                                <div class="chart-container">
                                    ${drawBarChart(stats.topCustomers.map(c => ({ label: c.pharmacy_name, value: c.totalUnits, totalCount: c.orderCount })))}
                                </div>
                            </div>
                        </div>

                        <div class="dashboard-row bottom-row">
                            <div class="card alert-card">
                                <h3>Critical Low Supply Items</h3>
                                ${stats.lowStockList && stats.lowStockList.length > 0 ? `
                                    <div class="alert-list-container">
                                        <ul class="alert-list">
                                            ${stats.lowStockList.map(item => `
                                                <li class="alert-item danger">
                                                    <span><strong>${item.name}</strong> (Current Stock: ${item.quantity})</span>
                                                    <button class="btn-primary-mini" onclick="loadModule('supplier_stock')">Upload CSV Restock</button>
                                                </li>
                                            `).join('')}
                                        </ul>
                                    </div>
                                ` : `<p class="no-alerts-msg">All warehouse levels are secure.</p>`}
                            </div>

                            <div class="card top-meds-card">
                                <h3>Top Demanded Medicines (By Total Qty Ordered)</h3>
                                <div class="table-container">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Medicine Name</th>
                                                <th>Dispatched Quantity</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${stats.topMeds && stats.topMeds.length > 0 ? stats.topMeds.map(m => `
                                                <tr>
                                                    <td><strong>${m.name}</strong></td>
                                                    <td>${m.totalQty} units</td>
                                                </tr>
                                            `).join('') : '<tr><td colspan="2" style="text-align:center">No order records found.</td></tr>'}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else if (moduleId === 'patient_dashboard') {
                const stats = await api.get('/api/patient/stats');
                html = `
                    <div class="dashboard-container">
                        <h2>Personal Health Analytics // Patient Records</h2>
                        
                        <div class="metrics-grid">
                            <div class="stat-card">
                                <h3>Total Requests Sent</h3>
                                <p class="stat-value text-blue">${stats.totalRequests} requests</p>
                            </div>
                            <div class="stat-card">
                                <h3>Completed Requests</h3>
                                <p class="stat-value text-success">${stats.completedRequests} fulfilled</p>
                            </div>
                            <div class="stat-card">
                                <h3>Pending Quotes</h3>
                                <p class="stat-value text-warning">${stats.pendingRequests} pending</p>
                            </div>
                            <div class="stat-card">
                                <h3>Total Healthcare Spent</h3>
                                <p class="stat-value text-purple">$${(Number(stats.totalSpent) || 0).toFixed(2)}</p>
                            </div>
                        </div>

                        <div class="dashboard-row">
                            <div class="card chart-card">
                                <h3>7-Day Spending History ($)</h3>
                                <div class="chart-container">
                                    ${drawLineChart(stats.spendingHistory.map(s => ({ xLabel: s.date, yValue: s.spent })))}
                                </div>
                            </div>
                            <div class="card chart-card">
                                <h3>Spending Breakdown by Category</h3>
                                <div class="chart-container">
                                    ${drawBarChart(stats.categoryBreakdown.map(c => ({ label: c.category, value: c.spent, totalCount: c.count })))}
                                </div>
                            </div>
                        </div>

                        <div class="dashboard-row bottom-row" style="grid-template-columns: 1fr;">
                            <div class="card top-meds-card">
                                <h3>Frequently Requested Medicines</h3>
                                <div class="table-container">
                                    <table>
                                        <thead>
                                            <tr>
                                                <th>Medicine Name</th>
                                                <th>Requests Count</th>
                                                <th>Fulfillments Count</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            ${stats.topMeds && stats.topMeds.length > 0 ? stats.topMeds.map(m => `
                                                <tr>
                                                    <td><strong>${m.name}</strong></td>
                                                    <td>${m.requests} times</td>
                                                    <td>${m.completed} times fulfilled</td>
                                                </tr>
                                            `).join('') : '<tr><td colspan="3" style="text-align:center">No purchase request records.</td></tr>'}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            } else if (moduleId === 'inventory') {
                const [inv, available, medicines] = await Promise.all([
                    api.get(`/api/pharmacist/inventory/${selectedPharmacyID}`),
                    api.get('/api/pharmacist/available-supplies'),
                    api.get('/api/medicines')
                ]);
                window.pharmacistAvailableSupplies = available;
                window.pharmacistMedicines = medicines;
                const groupedMeds = medicines.reduce((acc, m) => {
                    const cat = m.used_for || 'General';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(m);
                    return acc;
                }, {});
                html = `
                    <section>
                        <h2>Restock Pharmacy Inventory</h2>
                        <div class="card" style="padding: 2rem; margin-bottom: 2rem; border: 1px solid var(--border-soft);">
                            <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.2rem;">Choose a medicine from the catalog to see what it does and instantly order stock from approved suppliers or other pharmacies.</p>
                            
                            <div style="display: flex; flex-direction: column; gap: 1rem; margin-bottom: 1.5rem;">
                                <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                                    <label style="font-size: 0.85rem; color: var(--primary-blue); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Select Medicine to Restock</label>
                                    <div class="medicine-selection-list" style="max-height: 250px; overflow-y: auto; padding: 0.5rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 8px; display: flex; flex-direction: column; gap: 1rem;">
                                        ${Object.entries(groupedMeds).map(([category, list]) => `
                                            <div class="category-group">
                                                <h4 style="color: var(--primary-blue); margin: 0 0 0.5rem 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; border-left: 3px solid var(--primary-blue); padding-left: 0.5rem;">${category}</h4>
                                                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.6rem;">
                                                    ${list.map(m => `
                                                        <div class="pharma-med-select-item" onclick="window.selectPharmaRestockMedicine(${m.medicineID}, this)" style="padding: 0.7rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 0.4rem; transition: all 0.2s ease;">
                                                            <div>
                                                                <strong style="color: var(--text-main); font-size: 0.85rem; display: block;">${m.name}</strong>
                                                            </div>
                                                            <div class="select-status" style="font-size: 0.7rem; color: var(--primary-blue); text-align: right; font-weight: 600;">[ Select ]</div>
                                                        </div>
                                                    `).join('')}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                                <div id="pharmaMedUsageInfo" class="card" style="display: none; padding: 1.2rem; background: rgba(0, 91, 150, 0.08); border: 1px solid rgba(0, 91, 150, 0.15); border-radius: 8px;">
                                </div>
                            </div>
                            
                            <div id="pharmaRestockResults"></div>
                        </div>
                    </section>
                    <section>
                        <h2>Define & Add New Medicine Batch</h2>
                        <form id="addPharmaMedForm" style="margin-bottom:2rem">
                            <div class="form-grid">
                                <div class="form-group">
                                    <label>Medicine Name</label>
                                    <input type="text" name="name" placeholder="e.g. Amoxicillin" required>
                                </div>
                                <div class="form-group">
                                    <label>Used For (Category)</label>
                                    <input type="text" name="used_for" placeholder="e.g. Infection" required>
                                </div>
                                <div class="form-group">
                                    <label>Expiry Date</label>
                                    <input type="date" name="general_expiry_date" required>
                                </div>
                                <div class="form-group">
                                    <label>Initial Quantity</label>
                                    <input type="number" name="quantity" placeholder="e.g. 100" min="1" required>
                                </div>
                                <div class="form-group">
                                    <label>Price per Unit ($)</label>
                                    <input type="number" name="price_per_unit" placeholder="e.g. 25.00" step="0.01" min="0.00" required>
                                </div>
                            </div>
                            <button type="submit" class="btn-primary" style="margin-top:1.5rem">Add Batch to Inventory</button>
                        </form>
                    </section>
                    <section>
                        <h2>Current Stock Inventory</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Medicine Item</th>
                                        <th>Quantity Available</th>
                                        <th>Price per Unit ($)</th>
                                        <th>Expiration Alerts</th>
                                        <th>Quick Adjust</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${inv.map(i => `
                                        <tr>
                                            <td><strong>${i.name}</strong></td>
                                            <td>${i.quantity} units</td>
                                            <td>$${Number(i.price_per_unit || 0).toFixed(2)}</td>
                                            <td>${getExpiryStatusHTML(i.general_expiry_date)}</td>
                                            <td>
                                                <div style="display:flex;gap:0.5rem;align-items:center;">
                                                    <input type="number" id="s-${i.medicineID}" value="${i.quantity}" defaultValue="${i.quantity}" style="width:70px;padding:0.4rem" title="Quantity">
                                                    <input type="number" id="price-${i.medicineID}" value="${Number(i.price_per_unit || 0).toFixed(2)}" defaultValue="${Number(i.price_per_unit || 0).toFixed(2)}" step="0.01" min="0.00" style="width:80px;padding:0.4rem" title="Price per Unit">
                                                    <button class="btn-primary" style="padding:0.4rem 0.8rem;font-size:0.8rem;margin:0;" onclick="updateStock(${i.medicineID})">Set</button>
                                                </div>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            } else if (moduleId === 'orders') {
                const orders = (await api.get('/api/orders')).filter(o => o.status === 'pending' || o.pharmacyID == selectedPharmacyID);
                html = `<section><h2>Patient Request Fulfillment</h2><div class="table-container"><table><thead><tr><th>Request ID</th><th>Medicine Required</th><th>Action</th></tr></thead><tbody>${orders.map(o => `<tr><td>#${o.orderID}</td><td>${o.medicine_name}${o.general_expiry_date ? ` (Exp: ${o.general_expiry_date.split('T')[0]})` : ''}</td><td>${o.status === 'completed' ? '<span class="status-tag">SOLD</span>' : `<div style="display:flex;gap:0.5rem"><input type="number" id="p-${o.orderID}" placeholder="Unit Price ($)" style="width:120px;padding:0.4rem" required> <button class="btn-primary" style="padding:0.4rem 0.8rem;font-size:0.8rem" onclick="completeOrder(${o.orderID})">Sell & Fulfill</button></div>`}</td></tr>`).join('')}</tbody></table></div></section>`;
            } else if (moduleId === 'suggest_pharma') {
                html = `
                    <section>
                        <h2>Suggest New Pharmacy Entity</h2>
                        <form id="pharmaForm">
                            <div class="form-grid">
                                <div class="form-group"><label>Pharmacy Name</label><input type="text" name="name" placeholder="e.g. HealthShield" required></div>
                                <div class="form-group"><label>Location Context</label><input type="text" name="location" placeholder="City"></div>
                                <div class="form-group"><label>Supplier Company Partner</label><input type="text" name="supplier_company" placeholder="e.g. Allied Pharma"></div>
                            </div>
                            <div class="form-grid" style="margin-top:1rem;">
                                <div class="form-group"><label>Clinical Latitude</label><input type="text" id="pharmaLat" name="latitude" readonly required></div>
                                <div class="form-group"><label>Clinical Longitude</label><input type="text" id="pharmaLng" name="longitude" readonly required></div>
                            </div>
                            <div id="pharmaMapPicker"></div>
                            <button type="submit" class="btn-primary" style="margin-top:1.5rem">Submit Suggestion</button>
                        </form>
                    </section>
                `;
                setTimeout(() => {
                    const container = document.getElementById('pharmaMapPicker');
                    if (container) container.appendChild(window.initCoordinatePicker('pharmaLat', 'pharmaLng'));
                }, 0);
            }
            // SUPPLIER DASHBOARD MODULES
            else if (moduleId === 'supplier_stock') {
                const stock = await api.get('/api/supplier/stock');
                html = `
                    <section>
                        <h2>CSV Stock Import Uploader</h2>
                        <div class="drag-drop-zone" id="csvDragZone">
                            <p>Drag & drop your stock CSV file here (formatted as: <code>MedicineName, Quantity, [PricePerUnit]</code>)</p>
                            <p>or</p>
                            <button class="btn-select-file" type="button" onclick="document.getElementById('csvFileInput').click()">Browse Files</button>
                            <input type="file" id="csvFileInput" accept=".csv" style="display: none;">
                            <div id="selectedFileInfo" class="file-selected-info" style="display: none;"></div>
                        </div>
                    </section>
                    <section>
                        <h2>My Supply Stock Levels</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Medicine Name</th>
                                        <th>Units Available</th>
                                        <th>Price per Unit ($)</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${stock.length === 0 ? `<tr><td colspan="4" style="text-align:center">No stock uploaded yet. Upload a CSV above to initialize.</td></tr>` : stock.map(s => `
                                        <tr>
                                            <td><strong>${s.name}</strong></td>
                                            <td>
                                                <input type="number" id="sqty-${s.medicineID}" value="${s.quantity}" defaultValue="${s.quantity}" min="0" style="width: 100px; padding: 0.4rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 4px; color: var(--text-main);">
                                            </td>
                                            <td>
                                                <input type="number" id="sprice-${s.medicineID}" value="${Number(s.price_per_unit || 0).toFixed(2)}" defaultValue="${Number(s.price_per_unit || 0).toFixed(2)}" min="0" step="0.01" style="width: 100px; padding: 0.4rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 4px; color: var(--text-main);">
                                            </td>
                                            <td>
                                                <button class="btn-primary" style="padding: 0.4rem 0.8rem; font-size: 0.8rem; margin: 0; background: linear-gradient(45deg, var(--primary-blue), var(--secondary-teal));" onclick="window.updateSupplierStock(${s.medicineID})">Update</button>
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            } else if (moduleId === 'supplier_orders') {
                const orders = await api.get('/api/supplier/orders');
                html = `
                    <section>
                        <h2>Supplier Sales Orders</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Order ID</th>
                                        <th>Destination Pharmacy</th>
                                        <th>Medicine Name</th>
                                        <th>Units Delivered</th>
                                        <th>Order Date</th>
                                        <th>Fulfillment Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${orders.length === 0 ? `<tr><td colspan="6" style="text-align:center">No orders received yet.</td></tr>` : orders.map(o => `
                                        <tr>
                                            <td>#${o.sOrderID}</td>
                                            <td><strong>${o.pharmacy_name}</strong></td>
                                            <td>${o.medicine_name}</td>
                                            <td>${o.quantity} units</td>
                                            <td>${new Date(o.order_date).toLocaleString()}</td>
                                            <td><span class="status-tag">${o.status.toUpperCase()}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            }

            // SHARED / PATIENT MODULES
            else if (moduleId === 'medicines') {
                const meds = await api.get('/api/medicines');
                const categories = [...new Set(meds.map(m => m.used_for || 'General'))];
                html = `
                    <section>
                        <h2>Medicine Catalog</h2>
                        ${currentUser.role === 'admin' ? `
                            <form id="medForm" style="margin-bottom:2rem">
                                <div class="form-grid">
                                    <div class="form-group"><label>Medicine Name</label><input type="text" name="name" placeholder="e.g. Penicillin" required></div>
                                    <div class="form-group"><label>Used For (Category)</label><input type="text" name="used_for" placeholder="e.g. Infection" required></div>
                                    <div class="form-group"><label>General Expiry Date</label><input type="date" name="general_expiry_date" required></div>
                                </div>
                                <button type="submit" class="btn-primary" style="margin-top:1rem">Add to Global Catalog</button>
                            </form>
                        ` : ''}

                        <div class="toolbar">
                            <div class="filter-group">
                                <label>Filter Category:</label>
                                <select id="categoryFilter">
                                    <option value="all">All Categories</option>
                                    ${categories.map(c => `<option value="${c}">${c}</option>`).join('')}
                                </select>
                            </div>
                        </div>

                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Name</th>
                                        <th>Category (Used For)</th>
                                        <th>Expiry Date</th>
                                    </tr>
                                </thead>
                                <tbody id="medsCatalogBody">
                                    ${meds.map(m => `
                                        <tr class="medicine-row" data-category="${m.used_for || 'General'}">
                                            <td><strong>${m.name}</strong></td>
                                            <td><span class="status-tag" style="background:rgba(112,0,255,0.1);color:var(--primary-blue);border-color:var(--primary-blue)">${m.used_for || 'General'}</span></td>
                                            <td>${m.general_expiry_date ? m.general_expiry_date.split('T')[0] : 'N/A'}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            } else if (moduleId === 'myRecords') {
                const data = await api.get('/api/patients');
                const p = data[0] || {};
                let dob = '';
                if (p.dateOfBirth) {
                    dob = new Date(p.dateOfBirth).toISOString().split('T')[0];
                }
                html = `
                    <section>
                        <h2>My Profile & Secure Records</h2>
                        <form id="profileForm">
                            <div class="form-grid">
                                <div class="form-group"><label>First Name</label><input type="text" name="first_name" value="${p.first_name || ''}" required></div>
                                <div class="form-group"><label>Last Name</label><input type="text" name="last_name" value="${p.last_name || ''}" required></div>
                                <div class="form-group"><label>Date of Birth</label><input type="date" name="dateOfBirth" value="${dob}"></div>
                                <div class="form-group"><label>Condition / Chronic Disease</label><input type="text" name="disease" value="${p.disease || ''}"></div>
                                <div class="form-group"><label>Location Name</label><input type="text" name="location" value="${p.location || ''}"></div>
                            </div>
                            <div class="form-grid" style="margin-top:1rem;">
                                <div class="form-group"><label>Home Latitude</label><input type="text" id="profLat" name="latitude" value="${p.latitude || ''}" readonly></div>
                                <div class="form-group"><label>Home Longitude</label><input type="text" id="profLng" name="longitude" value="${p.longitude || ''}" readonly></div>
                            </div>
                            <div id="profMapPicker"></div>
                            <button type="submit" class="btn-primary" style="margin-top:1.5rem">Update Profile Records</button>
                        </form>
                    </section>
                `;
                setTimeout(() => {
                    const container = document.getElementById('profMapPicker');
                    if (container) container.appendChild(window.initCoordinatePicker('profLat', 'profLng'));
                }, 0);
                }
 else if (moduleId === 'myOrders') {
                const [complaints, orders, medicines] = await Promise.all([
                    api.get('/api/complaints'),
                    api.get('/api/orders'),
                    api.get('/api/medicines')
                ]);
                window.patientMedicines = medicines;
                const groupedMeds = medicines.reduce((acc, m) => {
                    const cat = m.used_for || 'General';
                    if (!acc[cat]) acc[cat] = [];
                    acc[cat].push(m);
                    return acc;
                }, {});
                html = `
                    <section>
                        <h2>Search & Compare Medicine Prices</h2>
                        <div class="card" style="padding: 2rem; margin-bottom: 2rem; border: 1px solid var(--border-soft);">
                            <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 1.2rem;">Choose a medicine to view its information and instantly compare prices across approved pharmacies.</p>
                            <div style="display: flex; flex-direction: column; gap: 1rem;">
                                <div style="display: flex; flex-direction: column; gap: 0.8rem;">
                                    <label style="font-size: 0.85rem; color: var(--primary-blue); text-transform: uppercase; letter-spacing: 0.5px; font-weight: 600;">Select Medicine from Catalog</label>
                                    <div class="medicine-selection-list" style="max-height: 250px; overflow-y: auto; padding: 0.5rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 8px; display: flex; flex-direction: column; gap: 1rem;">
                                        ${Object.entries(groupedMeds).map(([category, list]) => `
                                            <div class="category-group">
                                                <h4 style="color: var(--primary-blue); margin: 0 0 0.5rem 0; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 1px; border-left: 3px solid var(--primary-blue); padding-left: 0.5rem;">${category}</h4>
                                                <div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 0.6rem;">
                                                    ${list.map(m => `
                                                        <div class="med-select-item" onclick="window.selectPatientMedicine(${m.medicineID}, this)" style="padding: 0.7rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 8px; cursor: pointer; display: flex; flex-direction: column; justify-content: space-between; gap: 0.4rem; transition: all 0.2s ease;">
                                                            <div>
                                                                <strong style="color: var(--text-main); font-size: 0.85rem; display: block;">${m.name}</strong>
                                                            </div>
                                                            <div class="select-status" style="font-size: 0.7rem; color: var(--primary-blue); text-align: right; font-weight: 600;">[ Select ]</div>
                                                        </div>
                                                    `).join('')}
                                                </div>
                                            </div>
                                        `).join('')}
                                    </div>
                                </div>
                                <div id="medicineUsageInfo" class="card" style="display: none; padding: 1.2rem; background: rgba(0, 91, 150, 0.08); border: 1px solid rgba(0, 91, 150, 0.15); border-radius: 8px;">
                                </div>
                            </div>
                            <div id="searchResults" style="margin-top: 1.5rem;"></div>
                        </div>
                    </section>
                    
                    <section>
                        <h2>My Order History</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Medicine requested</th>
                                        <th>Pharmacy</th>
                                        <th>Price Cost</th>
                                        <th>Fulfillment Status</th>
                                        <th>Rating / Reviews</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${orders.length === 0 ? `<tr><td colspan="6" style="text-align:center">No requests sent yet.</td></tr>` : orders.map(o => `
                                        <tr>
                                            <td><strong>${o.medicine_name}</strong>${o.general_expiry_date ? ` <span style="font-size:0.8rem;opacity:0.7;">(Exp: ${o.general_expiry_date.split('T')[0]})</span>` : ''}</td>
                                            <td>${o.pharmacy_name || 'System Network'}</td>
                                            <td>
                                                $${Number(o.cost).toFixed(2)} ${o.auto_buy ? '<span style="font-size:0.75rem;opacity:0.7;color:var(--secondary-teal)">(Auto)</span>' : ''}
                                            </td>
                                            <td><span class="status-tag">${o.status.toUpperCase()}</span></td>
                                            <td>
                                                ${o.status === 'completed' 
                                                    ? (o.rating 
                                                        ? getStarRatingHTML(o.rating)
                                                        : `
                                                        <div class="rating-action" style="display: flex; gap: 0.5rem; align-items: center;">
                                                            <select id="rate-${o.orderID}" style="width: auto; padding: 0.2rem 0.5rem; min-height: auto; margin: 0; background: var(--surface-white); border: 1px solid var(--accent-orange); color: var(--text-main); border-radius: 4px; font-size:0.8rem;">
                                                                <option value="5">5 Stars</option>
                                                                <option value="4">4 Stars</option>
                                                                <option value="3">3 Stars</option>
                                                                <option value="2">2 Stars</option>
                                                                <option value="1">1 Star</option>
                                                            </select>
                                                            <button class="btn-primary" onclick="window.rateOrder(${o.orderID})" style="padding: 0.2rem 0.6rem; font-size: 0.8rem; margin: 0; min-height: auto; background: var(--accent-orange); box-shadow: 0 0 5px var(--accent-orange); border-color: var(--accent-orange)">Rate</button>
                                                        </div>
                                                        `
                                                    ) 
                                                    : '-'
                                                }
                                            </td>
                                            <td>
                                                ${o.status === 'completed' 
                                                    ? `<button class="btn-primary-mini" style="background: rgba(255,71,87,0.1); color: #ff4757; border-color: rgba(255,71,87,0.3);" onclick="window.showComplaintModal(${o.pharmacyID || 'null'}, ${o.orderID})">Complain</button>`
                                                    : '-'
                                                }
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>

                    <section style="margin-top: 2.5rem;">
                        <h2>My Filed Complaints</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>Subject</th>
                                        <th>Pharmacy</th>
                                        <th>Medicine</th>
                                        <th>Date Filed</th>
                                        <th>Details</th>
                                        <th>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${complaints.length === 0 ? `<tr><td colspan="6" style="text-align:center">No complaints filed yet.</td></tr>` : complaints.map(c => `
                                        <tr>
                                            <td><strong>${c.subject}</strong></td>
                                            <td>${c.pharmacy_name || 'N/A'}</td>
                                            <td>${c.medicine_name || 'N/A'}</td>
                                            <td>${c.created_at ? c.created_at.split('T')[0] : 'N/A'}</td>
                                            <td style="font-size: 0.85rem; max-width: 250px; white-space: normal; word-wrap: break-word;">${c.details}</td>
                                            <td><span class="status-tag" style="${c.status === 'resolved' ? 'background:rgba(0,255,136,0.1);color:#00ff88;border-color:#00ff88;' : 'background:rgba(255,71,87,0.1);color:#ff4757;border-color:#ff4757;'}">${c.status.toUpperCase()}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            } else if (moduleId === 'proposals') {
                const [proposals, meds] = await Promise.all([
                    api.get('/api/proposals'),
                    api.get('/api/medicines')
                ]);

                let actionFormHTML = '';

                if (currentUser.role === 'pharmacist') {
                    const [suppliers, myPharmacies] = await Promise.all([
                        api.get('/api/suppliers/approved'),
                        api.get('/api/pharmacist/my-pharmacies')
                    ]);
                    const approvedPharmacies = myPharmacies.filter(p => p.status === 'approved');

                    actionFormHTML = `
                        <div class="card" style="padding: 2rem; margin-bottom: 2rem; border: 1px solid var(--border-soft);">
                            <h3 style="margin-top: 0; margin-bottom: 1.5rem; color: var(--primary-blue);">Propose Restock to Supplier</h3>
                            <form id="pharmacistProposalForm">
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label>Destination Pharmacy</label>
                                        <select name="pharmacyID" required>
                                            ${approvedPharmacies.map(p => `<option value="${p.pharmacyID}">${p.name} (${p.location})</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Target Supplier</label>
                                        <select name="supplierID" required>
                                            ${suppliers.map(s => `<option value="${s.supplierID}">${s.name}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Medicine</label>
                                        <select name="medicineID" required>
                                            ${meds.map(m => `<option value="${m.medicineID}">${m.name}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Quantity</label>
                                        <input type="number" name="quantity" required min="1" placeholder="e.g. 100">
                                    </div>
                                    <div class="form-group">
                                        <label>Proposed Price per Unit ($)</label>
                                        <input type="number" name="proposed_price" step="0.01" required min="0.00" placeholder="e.g. 5.50">
                                    </div>
                                </div>
                                <button type="submit" class="btn-primary" style="margin-top: 1.5rem; background: linear-gradient(45deg, var(--primary-blue), #7000ff);">Send Proposal</button>
                            </form>
                        </div>
                    `;
                } else if (currentUser.role === 'supplier') {
                    const pharmacies = await api.get('/api/pharmacies/approved');
                    const supplierStock = await api.get('/api/supplier/stock');

                    actionFormHTML = `
                        <div class="card" style="padding: 2rem; margin-bottom: 2rem; border: 1px solid var(--border-soft);">
                            <h3 style="margin-top: 0; margin-bottom: 1.5rem; color: var(--primary-blue);">Propose Supply to Pharmacy</h3>
                            <form id="supplierProposalForm">
                                <input type="hidden" name="supplierID" value="${currentUser.userID}">
                                <div class="form-grid">
                                    <div class="form-group">
                                        <label>Target Pharmacy</label>
                                        <select name="pharmacyID" required>
                                            ${pharmacies.map(p => `<option value="${p.pharmacyID}">${p.name} (${p.location})</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Medicine (from your stock)</label>
                                        <select name="medicineID" required>
                                            ${supplierStock.length === 0 ? '<option value="">-- No Stock Available (Upload CSV first) --</option>' : supplierStock.map(s => `<option value="${s.medicineID}">${s.name} (In stock: ${s.quantity})</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="form-group">
                                        <label>Quantity</label>
                                        <input type="number" name="quantity" required min="1" placeholder="e.g. 50">
                                    </div>
                                    <div class="form-group">
                                        <label>Proposed Price per Unit ($)</label>
                                        <input type="number" name="proposed_price" step="0.01" required min="0.00" placeholder="e.g. 4.75">
                                    </div>
                                </div>
                                <button type="submit" class="btn-primary" style="margin-top: 1.5rem; background: linear-gradient(45deg, var(--primary-blue), #7000ff);" ${supplierStock.length === 0 ? 'disabled' : ''}>Send Proposal</button>
                            </form>
                        </div>
                    `;
                }

                html = `
                    <section>
                        <h2>Supplier / Pharmacist Stock Proposals</h2>
                        ${actionFormHTML}
                        
                        <h3>Active Proposals Registry</h3>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        <th>Pharmacy</th>
                                        <th>Supplier</th>
                                        <th>Medicine</th>
                                        <th>Qty</th>
                                        <th>Price / Unit</th>
                                        <th>Total Proposed</th>
                                        <th>Initiator</th>
                                        <th>Status</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${proposals.length === 0 ? `<tr><td colspan="10" style="text-align:center">No stock proposals found.</td></tr>` : proposals.map(p => {
                                        const isIncoming = (p.created_by === 'supplier' && currentUser.role === 'pharmacist') || 
                                                         (p.created_by === 'pharmacist' && currentUser.role === 'supplier');
                                        const totalVal = Number(p.quantity) * Number(p.proposed_price);
                                        return `
                                            <tr>
                                                <td>#${p.proposalID}</td>
                                                <td><strong>${p.pharmacy_name}</strong></td>
                                                <td>${p.supplier_name}</td>
                                                <td><strong>${p.medicine_name}</strong></td>
                                                <td>${p.quantity} units</td>
                                                <td>$${Number(p.proposed_price).toFixed(2)}</td>
                                                <td style="color: var(--success); font-weight: 600;">$${totalVal.toFixed(2)}</td>
                                                <td><span class="status-tag" style="background: #fbfbfc; color: var(--text-main); border-color: var(--border-soft);">${p.created_by.toUpperCase()}</span></td>
                                                <td><span class="status-tag" style="${
                                                    p.status === 'approved' ? 'background:rgba(0,255,136,0.1);color:#00ff88;border-color:#00ff88;' :
                                                    p.status === 'rejected' ? 'background:rgba(255,71,87,0.1);color:#ff4757;border-color:#ff4757;' :
                                                    'background:rgba(255,159,10,0.1);color:#ff9f0a;border-color:#ff9f0a;'
                                                }">${p.status.toUpperCase()}</span></td>
                                                <td>
                                                    ${p.status === 'pending' && isIncoming
                                                        ? `<button class="btn-primary-mini" style="background: var(--success); border-color: var(--success);" onclick="window.resolveProposal(${p.proposalID}, 'approved')">Approve</button>
                                                           <button class="btn-primary-mini" style="background: red; border-color: red; margin-left: 0.5rem;" onclick="window.resolveProposal(${p.proposalID}, 'rejected')">Reject</button>`
                                                        : (p.status === 'pending' ? '<span style="color: var(--text-muted); font-style: italic;">Awaiting response</span>' : '-')
                                                    }
                                                </td>
                                            </tr>
                                        `;
                                    }).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            } else if (moduleId === 'complaints') {
                const complaints = await api.get('/api/complaints');
                html = `
                    <section>
                        <h2>Pharmacy Complaints & Dispute Resolution</h2>
                        <div class="table-container">
                            <table>
                                <thead>
                                    <tr>
                                        <th>ID</th>
                                        ${currentUser.role !== 'patient' ? '<th>Patient</th>' : ''}
                                        <th>Pharmacy</th>
                                        <th>Medicine</th>
                                        <th>Subject</th>
                                        <th>Details</th>
                                        <th>Date</th>
                                        <th>Status</th>
                                        ${currentUser.role !== 'patient' ? '<th>Action</th>' : ''}
                                    </tr>
                                </thead>
                                <tbody>
                                    ${complaints.length === 0 ? `<tr><td colspan="${currentUser.role !== 'patient' ? 9 : 7}" style="text-align:center">No complaints filed.</td></tr>` : complaints.map(c => `
                                        <tr>
                                            <td>#${c.complaintID}</td>
                                            ${currentUser.role !== 'patient' ? `<td><strong>${c.patient_username || 'Patient'}</strong></td>` : ''}
                                            <td>${c.pharmacy_name || 'N/A'}</td>
                                            <td>${c.medicine_name || 'N/A'}</td>
                                            <td><strong>${c.subject}</strong></td>
                                            <td style="font-size:0.85rem; max-width: 250px; white-space: normal; word-wrap: break-word;">${c.details}</td>
                                            <td>${c.created_at ? c.created_at.split('T')[0] : 'N/A'}</td>
                                            <td><span class="status-tag" style="${c.status === 'resolved' ? 'background:rgba(0,255,136,0.1);color:#00ff88;border-color:#00ff88;' : 'background:rgba(255,71,87,0.1);color:#ff4757;border-color:#ff4757;'}">${c.status.toUpperCase()}</span></td>
                                            ${currentUser.role !== 'patient' ? `
                                                <td>
                                                    ${c.status === 'pending' 
                                                        ? `<button class="btn-primary-mini" style="background: var(--success); border-color: var(--success);" onclick="window.resolveComplaint(${c.complaintID})">Resolve</button>` 
                                                        : '-'
                                                    }
                                                </td>
                                            ` : ''}
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </section>
                `;
            }

            UI.contentArea.innerHTML = html;
            UI.contentArea.style.transition = 'opacity 0.3s ease';
            UI.contentArea.style.opacity = '1';

            // --- WIRE UP PAGE EVENT LISTENERS AFTER RENDERING ---

            if (moduleId === 'myOrders') {
                // Dropdown select change triggers lookup automatically
            }

            // Proposals forms
            const patientProposalF = document.getElementById('patientProposalForm');
            if (patientProposalF) {
                patientProposalF.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(patientProposalF);
                    const payload = {
                        type: 'patient_to_pharma',
                        medicineID: formData.get('medicineID'),
                        quantity: formData.get('quantity'),
                        proposed_price: formData.get('proposed_price'),
                        responderID: formData.get('responderID')
                    };
                    try {
                        const res = await api.post('/api/proposals', payload);
                        if (res.ok) {
                            window.showToast('Clinical proposal broadcasted successfully.', 'success');
                            loadModule('proposals');
                        } else {
                            const data = await res.json();
                            window.showToast(data.error || 'Market broadcast failed.', 'error');
                        }
                    } catch (err) { window.showToast('Network error during broadcast.', 'error'); }
                });
            }

            const pharmaProposalF = document.getElementById('pharmacistProposalForm');
            if (pharmaProposalF) {
                pharmaProposalF.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(pharmaProposalF);
                    const payload = {
                        type: 'pharma_to_supplier',
                        initiatorID: formData.get('initiatorID'),
                        responderID: formData.get('responderID'),
                        medicineID: formData.get('medicineID'),
                        quantity: formData.get('quantity'),
                        proposed_price: formData.get('proposed_price')
                    };
                    try {
                        const res = await api.post('/api/proposals', payload);
                        if (res.ok) {
                            window.showToast('Acquisition bid submitted to supplier.', 'success');
                            loadModule('proposals');
                        } else {
                            const data = await res.json();
                            window.showToast(data.error || 'Bid submission failed.', 'error');
                        }
                    } catch (err) { window.showToast('Network error during bid submission.', 'error'); }
                });
            }

            const supplierProposalF = document.getElementById('supplierProposalForm');
            // supplierProposalForm removed in V4 in favor of dynamic response to pharmacist bids, 
            // but we keep the listener if it exists for future direct-to-pharma supplier proposals.
            if (supplierProposalF) {
                supplierProposalF.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(supplierProposalF);
                    const payload = {
                        type: 'pharma_to_supplier', // Inverted for supplier-initiated
                        responderID: formData.get('pharmacyID'),
                        initiatorID: formData.get('pharmacyID'), // Type-specific mapping
                        medicineID: formData.get('medicineID'),
                        quantity: formData.get('quantity'),
                        proposed_price: formData.get('proposed_price')
                    };
                    try {
                        const res = await api.post('/api/proposals', payload);
                        if (res.ok) {
                            window.showToast('Supply proposal sent to pharmacy.', 'success');
                            loadModule('proposals');
                        } else {
                            const data = await res.json();
                            window.showToast(data.error || 'Supply proposal failed.', 'error');
                        }
                    } catch (err) { window.showToast('Network error during proposal.', 'error'); }
                });
            }

            // Restock form submit
            const restockF = document.getElementById('restockForm');
            if (restockF) {
                restockF.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const sourceVal = document.getElementById('restockSource').value;
                    if (!sourceVal) {
                        window.showToast('Please select a valid supplier/pharmacy source.', 'error');
                        return;
                    }
                    const [sourceType, sourceID, medicineID] = sourceVal.split(':');
                    const qty = document.getElementById('restockQty').value;
                    try {
                        const res = await api.post('/api/pharmacist/restock', {
                            pharmacyID: selectedPharmacyID,
                            medicineID,
                            quantity: qty,
                            sourceType,
                            sourceID
                        });
                        const data = await res.json();
                        if (res.ok) {
                            window.showToast(data.message || 'Restocking transfer successful.', 'success');
                            loadModule(moduleId);
                        } else {
                            window.showToast(data.error || 'Restocking failed.', 'error');
                        }
                    } catch (err) {
                        window.showToast('Error execution failed.', 'error');
                    }
                });
            }

            // Drag and drop logic for supplier stock
            const dragZone = document.getElementById('csvDragZone');
            const fileInput = document.getElementById('csvFileInput');
            const infoDiv = document.getElementById('selectedFileInfo');
            if (dragZone && fileInput) {
                const preventAll = (e) => { e.preventDefault(); e.stopPropagation(); };
                ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => dragZone.addEventListener(evt, preventAll));
                
                dragZone.addEventListener('dragenter', () => dragZone.classList.add('dragover'));
                dragZone.addEventListener('dragover', () => dragZone.classList.add('dragover'));
                dragZone.addEventListener('dragleave', () => dragZone.classList.remove('dragover'));
                dragZone.addEventListener('drop', (e) => {
                    dragZone.classList.remove('dragover');
                    const files = e.dataTransfer.files;
                    if (files && files.length > 0) {
                        const file = files[0];
                        if (file.name.endsWith('.csv')) {
                            fileInput.files = files;
                            infoDiv.innerText = `Selected File: ${file.name} (${file.size} bytes). Processing...`;
                            infoDiv.style.display = 'block';
                            uploadCSVFile(file);
                        } else {
                            window.showToast('Invalid format. Please upload a .csv file.', 'error');
                        }
                    }
                });

                fileInput.addEventListener('change', () => {
                    if (fileInput.files.length > 0) {
                        const file = fileInput.files[0];
                        infoDiv.innerText = `Selected File: ${file.name} (${file.size} bytes). Processing...`;
                        infoDiv.style.display = 'block';
                        uploadCSVFile(file);
                    }
                });
            }

            // Category filter listener
            const catFilter = document.getElementById('categoryFilter');
            if (catFilter) {
                catFilter.addEventListener('change', () => {
                    const selectedCat = catFilter.value;
                    const rows = document.querySelectorAll('.medicine-row');
                    rows.forEach(row => {
                        if (selectedCat === 'all' || row.dataset.category === selectedCat) {
                            row.style.display = '';
                        } else {
                            row.style.display = 'none';
                        }
                    });
                });
            }

            // Patient profile updates
            const profForm = document.getElementById('profileForm');
            if (profForm) {
                profForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const payload = Object.fromEntries(new FormData(profForm).entries());
                    try {
                        const res = await api.put('/api/patients', payload);
                        if (res.ok) {
                            window.showToast('Secure profile updated successfully.', 'success');
                            loadModule(moduleId);
                        } else {
                            const d = await res.json();
                            window.showToast(d.error || 'Profile update failed.', 'error');
                        }
                    } catch (err) {
                        window.showToast('System profile error.', 'error');
                    }
                });
            }

            // Normal form attachments (Direct API posts)
            const attach = (id, url, isMulti = false) => {
                const f = document.getElementById(id);
                if (f) f.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const body = isMulti ? new FormData(f) : { pharmacyID: selectedPharmacyID, ...Object.fromEntries(new FormData(f).entries()) };
                    const res = await api.post(url, body, isMulti);
                    if (res.ok) { window.showToast('Action Authorized Successfully', 'success'); loadModule(moduleId); } 
                    else { const d = await res.json(); window.showToast(d.error || 'Access Denied', 'error'); }
                });
            };
            attach('pharmaForm', '/api/pharmacies', false);
            attach('orderForm', '/api/orders');
            attach('medForm', '/api/medicines');

            // Pharmacist Add Custom Medicine Batch
            const addPharmaMedForm = document.getElementById('addPharmaMedForm');
            if (addPharmaMedForm) {
                addPharmaMedForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    const formData = new FormData(addPharmaMedForm);
                    const payload = {
                        pharmacyID: selectedPharmacyID,
                        name: formData.get('name'),
                        used_for: formData.get('used_for'),
                        general_expiry_date: formData.get('general_expiry_date'),
                        quantity: formData.get('quantity'),
                        price_per_unit: formData.get('price_per_unit')
                    };
                    try {
                        const res = await api.post('/api/pharmacist/add-medicine', payload);
                        if (res.ok) {
                            window.showToast('Medicine batch added/updated in stock.', 'success');
                            loadModule(moduleId);
                        } else {
                            const d = await res.json();
                            window.showToast(d.error || 'Failed to add medicine batch.', 'error');
                        }
                    } catch (err) {
                        window.showToast('System error adding medicine batch.', 'error');
                    }
                });
            }

        } catch (err) { 
            console.error(err);
            UI.contentArea.innerHTML = '<p style="color:red;text-align:center; padding:2rem">Security Error: Could not fetch module data.</p>'; 
        }
    };

    // --- FILE UPLOADER FOR SUPPLIER STOCK ---
    const uploadCSVFile = async (file) => {
        const formData = new FormData();
        formData.append('csv_file', file);
        try {
            const res = await api.post('/api/supplier/upload-csv', formData, true);
            const data = await res.json();
            if (res.ok) {
                window.showToast(data.message || 'Stock CSV imported successfully.', 'success');
                loadModule('supplier_stock');
            } else {
                window.showToast(data.error || 'CSV Upload failed.', 'error');
            }
        } catch (err) {
            window.showToast('Security connection error during file upload.', 'error');
        }
    };

    // --- GLOBAL WINDOW ACTIONS ---
    // --- GLOBAL WINDOW ACTIONS ---
    window.selectPharmacy = (id) => { selectedPharmacyID = id; localStorage.setItem('selectedPharmacyID', id); initApp(); };
    window.deletePharmacy = async (id) => { if (confirm('Irreversibly delete this entity?')) { await api.delete(`/api/pharmacies/${id}`); if (id == selectedPharmacyID) { selectedPharmacyID = null; localStorage.removeItem('selectedPharmacyID'); } loadModule('my_pharmacies'); } };
    window.updateStock = async (medID) => {
        const qInput = document.getElementById(`s-${medID}`);
        const pInput = document.getElementById(`price-${medID}`);
        if (!qInput || !pInput) return;
        const newQty = qInput.value;
        const newPrice = pInput.value;
        const prevQty = qInput.defaultValue;
        const prevPrice = pInput.defaultValue;

        const res = await api.patch('/api/pharmacist/inventory', { pharmacyID: selectedPharmacyID, medicineID: medID, quantity: newQty, price: newPrice });
        if (res.ok) {
            window.showToast('Inventory & Price Adjusted', 'success');
            window.pushUndo({
                description: `Adjusted stock of medicine #${medID}`,
                undo: async () => {
                    await api.patch('/api/pharmacist/inventory', { pharmacyID: selectedPharmacyID, medicineID: medID, quantity: prevQty, price: prevPrice });
                    loadModule('inventory');
                }
            });
            loadModule('inventory');
        } else {
            window.showToast('Failed to adjust inventory', 'error');
        }
    };
    window.completeOrder = async (id) => { const c = document.getElementById(`p-${id}`).value; if (!c) return window.showToast('Input Required: Price', 'error'); const res = await api.patch(`/api/orders/${id}/complete`, { cost: c, pharmacyID: selectedPharmacyID }); if (res.ok) loadModule('orders'); else { const d = await res.json(); window.showToast(d.error || 'Transaction Failed', 'error'); } };
    window.verifyUser = async (uid, act) => {
        try {
            const res = await api.post('/api/admin/verify-user', { userID: uid, action: act });
            if (res.ok) {
                window.pushUndo({
                    description: `${act === 'approved' ? 'Verified' : 'Rejected'} User #${uid}`,
                    undo: async () => {
                        await api.post('/api/admin/verify-user', { userID: uid, action: 'pending' });
                        loadModule(currentModule);
                    }
                });
                loadModule(currentModule);
            }
        } catch (err) { console.error(err); }
    };
    window.verifyPharma = async (pid, act) => {
        try {
            const res = await api.post('/api/admin/verify-pharmacy', { pharmacyID: pid, action: act });
            if (res.ok) {
                window.pushUndo({
                    description: `${act === 'approved' ? 'Verified' : 'Rejected'} Pharmacy #${pid}`,
                    undo: async () => {
                        await api.post('/api/admin/verify-pharmacy', { pharmacyID: pid, action: 'pending' });
                        loadModule('admin_pharma');
                    }
                });
                loadModule('admin_pharma');
            }
        } catch (err) { console.error(err); }
    };

    window.deleteUser = async (userID) => {
        if (confirm('Permanently delete this user? All their associated records (pharmacy suggestions, stock inventory, and order records) will be deleted.')) {
            try {
                const res = await api.delete(`/api/admin/users/${userID}`);
                const data = await res.json();
                if (res.ok) {
                    window.showToast(data.message || 'User deleted successfully.', 'success');
                    loadModule('admin_registry');
                } else {
                    window.showToast(data.error || 'Failed to delete user.', 'error');
                }
            } catch (err) {
                console.error(err);
                window.showToast('Connection error during deletion.', 'error');
            }
        }
    };

    window.startEditUser = (userID, username, email, role, status) => {
        const row = document.getElementById(`user-row-${userID}`);
        if (!row) return;
        row.innerHTML = `
            <td><input type="text" id="edit-username-${userID}" value="${username}" style="padding:0.3rem; width:100%; max-width:150px; background: #fbfbfc; color: var(--text-main); border: 1px solid var(--border-soft); border-radius:4px;"></td>
            <td>
                <select id="edit-role-${userID}" style="padding:0.3rem; background: #fbfbfc; color: var(--text-main); border: 1px solid var(--border-soft); border-radius:4px;">
                    <option value="admin" ${role === 'admin' ? 'selected' : ''}>ADMIN</option>
                    <option value="pharmacist" ${role === 'pharmacist' ? 'selected' : ''}>PHARMACIST</option>
                    <option value="supplier" ${role === 'supplier' ? 'selected' : ''}>SUPPLIER</option>
                    <option value="patient" ${role === 'patient' ? 'selected' : ''}>PATIENT</option>
                </select>
            </td>
            <td><input type="email" id="edit-email-${userID}" value="${email}" style="padding:0.3rem; width:100%; max-width:180px; background: #fbfbfc; color: var(--text-main); border: 1px solid var(--border-soft); border-radius:4px;"></td>
            <td>
                <select id="edit-status-${userID}" style="padding:0.3rem; background: #fbfbfc; color: var(--text-main); border: 1px solid var(--border-soft); border-radius:4px;">
                    <option value="pending" ${status === 'pending' ? 'selected' : ''}>PENDING</option>
                    <option value="approved" ${status === 'approved' ? 'selected' : ''}>APPROVED</option>
                    <option value="rejected" ${status === 'rejected' ? 'selected' : ''}>REJECTED</option>
                </select>
            </td>
            <td style="text-align: center;">
                <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin:0 0.3rem 0 0; background:green" onclick="window.saveEditUser(${userID})">Save</button>
                <button class="btn-primary" style="padding:0.4rem 0.8rem; font-size:0.8rem; margin:0; background:grey" onclick="loadModule('admin_registry')">Cancel</button>
            </td>
        `;
    };

    window.saveEditUser = async (userID) => {
        const uInput = document.getElementById(`edit-username-${userID}`);
        const rInput = document.getElementById(`edit-role-${userID}`);
        const eInput = document.getElementById(`edit-email-${userID}`);
        const sInput = document.getElementById(`edit-status-${userID}`);
        if (!uInput || !rInput || !eInput || !sInput) return;
        
        const payload = {
            username: uInput.value.trim(),
            role: rInput.value,
            email: eInput.value.trim(),
            status: sInput.value
        };

        if (!payload.username) {
            window.showToast('Username cannot be empty.', 'error');
            return;
        }

        try {
            const res = await api.put(`/api/admin/users/${userID}`, payload);
            const data = await res.json();
            if (res.ok) {
                window.showToast(data.message || 'User updated successfully.', 'success');
                loadModule('admin_registry');
            } else {
                window.showToast(data.error || 'Failed to update user.', 'error');
            }
        } catch (err) {
            console.error(err);
            window.showToast('Connection error during update.', 'error');
        }
    };
    window.rateOrder = async (id) => { 
        const r = document.getElementById(`rate-${id}`).value; 
        const res = await api.patch(`/api/orders/${id}/rate`, { rating: r }); 
        if (res.ok) { 
            window.showToast('Rating submitted successfully!', 'success'); 
            loadModule('myOrders'); 
        } else { 
            const d = await res.json(); 
            window.showToast(d.error || 'Failed to submit rating.', 'error'); 
        } 
    };

    const getStarRatingHTML = (rating) => {
        const fullStar = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#f39c12" style="margin-right:2px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
        const emptyStar = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#e0e6e9" style="margin-right:2px;"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
        let html = '<div style="display:flex;">';
        for (let i = 1; i <= 5; i++) {
            html += i <= rating ? fullStar : emptyStar;
        }
        html += '</div>';
        return html;
    };
    
    window.disposeMedicine = async (pharmacyID, medicineID) => {
        if (confirm('Are you sure you want to dispose of this medicine? This will delete it from your stock.')) {
            const res = await api.post('/api/pharmacist/dispose', { pharmacyID, medicineID });
            if (res.ok) {
                window.showToast('Medicine successfully disposed.', 'success');
                loadModule('dashboard');
            } else {
                const data = await res.json();
                window.showToast(data.error || 'Failed to dispose of medicine.', 'error');
            }
        }
    };

    window.resolveProposal = async (id, status) => {
        const actionStr = status === 'approved' ? 'approve' : 'reject';
        if (confirm(`Are you sure you want to ${actionStr} this proposal?`)) {
            const res = await api.patch(`/api/proposals/${id}/status`, { status });
            if (res.ok) {
                window.showToast(`Proposal successfully ${status}.`, 'success');
                loadModule('proposals');
            } else {
                const data = await res.json();
                window.showToast(data.error || `Failed to ${actionStr} proposal.`, 'error');
            }
        }
    };

    window.resolveComplaint = async (id) => {
        if (confirm('Mark this complaint as resolved?')) {
            const res = await api.patch(`/api/complaints/${id}/resolve`);
            if (res.ok) {
                window.showToast('Complaint marked as resolved.', 'success');
                loadModule('complaints');
            } else {
                const data = await res.json();
                window.showToast(data.error || 'Failed to resolve complaint.', 'error');
            }
        }
    };

    window.selectPatientMedicine = (medID, element) => {
        document.querySelectorAll('.med-select-item').forEach(el => {
            el.style.background = '#fbfbfc';
            el.style.borderColor = 'var(--border-soft)';
            el.style.boxShadow = 'none';
            const status = el.querySelector('.select-status');
            if (status) {
                status.innerText = '[ Select ]';
                status.style.color = 'var(--primary-blue)';
            }
        });

        if (element) {
            element.style.background = 'rgba(0, 91, 150, 0.08)';
            element.style.borderColor = 'var(--primary-blue)';
            element.style.boxShadow = '0 0 0 4px rgba(0, 91, 150, 0.08)';
            const status = element.querySelector('.select-status');
            if (status) {
                status.innerText = 'Active';
                status.style.color = 'var(--success)';
            }
        }
        window.handlePatientMedicineChange(medID);
    };

    window.selectPharmaRestockMedicine = (medID, element) => {
        document.querySelectorAll('.pharma-med-select-item').forEach(el => {
            el.style.background = '#fbfbfc';
            el.style.borderColor = 'var(--border-soft)';
            el.style.boxShadow = 'none';
            const status = el.querySelector('.select-status');
            if (status) {
                status.innerText = '[ Select ]';
                status.style.color = 'var(--primary-blue)';
            }
        });

        if (element) {
            element.style.background = 'rgba(0, 91, 150, 0.08)';
            element.style.borderColor = 'var(--primary-blue)';
            element.style.boxShadow = '0 0 0 4px rgba(0, 91, 150, 0.08)';
            const status = element.querySelector('.select-status');
            if (status) {
                status.innerText = 'Active';
                status.style.color = 'var(--success)';
            }
        }
        window.handlePharmaRestockMedChange(medID);
    };

    window.handlePatientMedicineChange = async (medID) => {
        const usageInfo = document.getElementById('medicineUsageInfo');
        const resultsDiv = document.getElementById('searchResults');
        
        if (!medID) {
            usageInfo.style.display = 'none';
            resultsDiv.innerHTML = '';
            return;
        }

        // Find medicine details in cached list
        const med = (window.patientMedicines || []).find(m => m.medicineID == medID);
        if (med) {
            usageInfo.innerHTML = `
                <h4 style="color: var(--primary-blue); margin-bottom: 0.4rem; font-size: 1.05rem; letter-spacing: 0.5px;">About ${med.name}</h4>
                <p style="font-size: 0.9rem; color: var(--text-main); margin: 0 0 0.3rem 0;"><strong>What it does:</strong> ${med.used_for || 'General use / category unspecified.'}</p>
                ${med.general_expiry_date ? `<p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">Standard Expiry Limit: ${med.general_expiry_date.split('T')[0]}</p>` : ''}
            `;
            usageInfo.style.display = 'block';
        } else {
            usageInfo.style.display = 'none';
        }

        resultsDiv.innerHTML = '<p style="color: var(--text-muted);">Comparing prices across pharmacies...</p>';
        try {
            const availability = await api.get(`/api/medicines/${medID}/availability`);
            if (availability.length === 0) {
                resultsDiv.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 0.95rem; margin-top: 1rem;">Out of stock in all approved pharmacies.</p>';
                return;
            }

            // Sort cheapest first
            availability.sort((a, b) => Number(a.price_per_unit) - Number(b.price_per_unit));

            resultsDiv.innerHTML = `
                <div style="margin-top: 1.5rem;">
                    <h4 style="color: var(--text-main); margin-bottom: 1rem; font-size: 1.1rem; border-bottom: 1px solid var(--border-soft); padding-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px;">Available Pharmacy Offers (Cheapest first)</h4>
                    <div class="availability-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1rem;">
                        ${availability.map(p => `
                            <div class="stat-card" style="display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--border-soft); padding: 1.2rem; border-radius: 12px; background: #fbfbfc; transition: all 0.3s ease;">
                                <div>
                                    <h5 style="color: var(--primary-blue); margin: 0 0 0.4rem 0; font-size: 1.05rem;">${p.medicine_name} at ${p.pharmacy_name}</h5>
                                    <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.8rem;">Location: ${p.location}</p>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                                        <div>
                                            <span style="font-size: 0.75rem; color: var(--text-muted); display: block; text-transform: uppercase;">Price</span>
                                            <span style="font-size: 1.25rem; color: var(--success); font-weight: bold; text-shadow: 0 0 8px rgba(0, 255, 136, 0.2);">$${Number(p.price_per_unit).toFixed(2)}</span>
                                        </div>
                                        <div style="text-align: right;">
                                            <span style="font-size: 0.75rem; color: var(--text-muted); display: block; text-transform: uppercase;">Stock</span>
                                            <span style="font-size: 0.95rem; color: var(--text-main); font-weight: 600;">${p.quantity} units</span>
                                        </div>
                                    </div>
                                </div>
                                <div style="display: flex; gap: 0.5rem;">
                                    <button class="btn-primary" style="flex: 1; padding: 0.6rem 0.8rem; font-size: 0.8rem; margin: 0; background: linear-gradient(45deg, #00ff88, #00f2ff);" onclick="window.instantBuy(${medID}, ${p.pharmacyID}, ${p.price_per_unit})">Buy Instantly</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        } catch (err) {
            console.error(err);
            resultsDiv.innerHTML = '<p style="color: red;">Error performing search.</p>';
        }
    };

    window.showComplaintModal = (pharmacyID, orderID = null) => {
        let modal = document.getElementById('complaintModal');
        if (!modal) {
            modal = document.createElement('div');
            modal.id = 'complaintModal';
            modal.style.cssText = `
                position: fixed;
                top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(0, 0, 0, 0.4);
                backdrop-filter: blur(8px);
                display: flex; align-items: center; justify-content: center;
                z-index: 10000;
            `;
            document.body.appendChild(modal);
        }
        modal.innerHTML = `
            <div class="card" style="width: 100%; max-width: 500px; padding: 2rem; border: 1px solid var(--border-soft); background: var(--surface-white); position: relative; border-radius: 16px; box-shadow: 0 10px 40px rgba(0,0,0,0.08);">
                <h3 style="color: var(--accent-orange); margin-top: 0; font-size: 1.4rem;">File a Complaint</h3>
                <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1.5rem;">Please describe the issue. Our support team and the pharmacist will review it.</p>
                <form id="modalComplaintForm">
                    <input type="hidden" name="pharmacyID" value="${pharmacyID || ''}">
                    <input type="hidden" name="orderID" value="${orderID || ''}">
                    <div class="form-group" style="margin-bottom: 1.2rem;">
                        <label style="color: var(--text-main); font-size: 0.9rem;">Subject / Title</label>
                        <input type="text" name="subject" required placeholder="e.g. Overcharged, Expired meds, Poor service" style="background: #fbfbfc; border: 1px solid var(--border-soft); color: var(--text-main); border-radius: 8px; width: 100%; padding: 0.6rem; min-height: auto;">
                    </div>
                    <div class="form-group" style="margin-bottom: 1.5rem;">
                        <label style="color: var(--text-main); font-size: 0.9rem;">Detailed Complaint Description</label>
                        <textarea name="details" required rows="4" placeholder="Describe your issue in detail..." style="background: #fbfbfc; border: 1px solid var(--border-soft); color: var(--text-main); border-radius: 8px; width: 100%; padding: 0.6rem; resize: vertical; min-height: auto; font-family: inherit;"></textarea>
                    </div>
                    <div style="display: flex; gap: 1rem; justify-content: flex-end;">
                        <button type="button" class="btn-primary" style="background: transparent; border: 1px solid var(--border-soft); color: var(--text-main); margin: 0; padding: 0.6rem 1.2rem;" onclick="window.closeComplaintModal()">Cancel</button>
                        <button type="submit" class="btn-primary" style="background: linear-gradient(45deg, #ff4757, #ff6b81); border: none; margin: 0; padding: 0.6rem 1.2rem; box-shadow: 0 0 10px rgba(255, 71, 87, 0.4);">Submit Complaint</button>
                    </div>
                </form>
            </div>
        `;
        modal.style.display = 'flex';
        
        const form = document.getElementById('modalComplaintForm');
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const formData = new FormData(form);
            const payload = Object.fromEntries(formData.entries());
            try {
                const res = await api.post('/api/complaints', payload);
                if (res.ok) {
                    window.showToast('Complaint submitted successfully!', 'success');
                    window.closeComplaintModal();
                    loadModule(currentModule);
                } else {
                    const data = await res.json();
                    window.showToast(data.error || 'Failed to submit complaint.', 'error');
                }
            } catch (err) {
                window.showToast('Error submitting complaint.', 'error');
            }
        });
    };

    window.closeComplaintModal = () => {
        const modal = document.getElementById('complaintModal');
        if (modal) modal.style.display = 'none';
    };

    window.loadMedicineAvailability = async (medID) => {
        const instantBuySec = document.getElementById('instantBuySection');
        const panel = document.getElementById('availabilityPanel');
        if (!panel) return;
        try {
            const data = await api.get(`/api/medicines/${medID}/availability`);
            if (data.length > 0) {
                if (instantBuySec) instantBuySec.style.display = 'block';
                panel.innerHTML = `
                    <div class="availability-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 1.5rem; margin-top: 1rem;">
                        ${data.map(p => `
                            <div class="stat-card" style="display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--border-soft); padding: 1.5rem; border-radius: 12px; background: #fbfbfc; transition: all 0.3s ease;">
                                <div>
                                    <h4 style="color: var(--primary-blue); margin-bottom: 0.5rem; font-size: 1.1rem; text-shadow: 0 0 8px rgba(0, 91, 150, 0.2);">${p.medicine_name} at ${p.pharmacy_name}</h4>
                                    <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">Location: ${p.location}</p>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.5rem;">
                                        <div>
                                            <span style="font-size: 0.8rem; color: var(--text-muted); display: block; text-transform: uppercase; letter-spacing: 0.5px;">Price</span>
                                            <span style="font-size: 1.3rem; color: var(--success); font-weight: bold; text-shadow: 0 0 8px rgba(0, 255, 136, 0.2);">$${Number(p.price_per_unit).toFixed(2)}</span>
                                        </div>
                                        <div style="text-align: right;">
                                            <span style="font-size: 0.8rem; color: var(--text-muted); display: block; text-transform: uppercase; letter-spacing: 0.5px;">Stock</span>
                                            <span style="font-size: 1rem; color: var(--text-main); font-weight: 600;">${p.quantity} units</span>
                                        </div>
                                    </div>
                                </div>
                                <button class="btn-primary" style="padding: 0.7rem 1rem; font-size: 0.85rem; width: 100%; margin: 0; background: linear-gradient(45deg, #00ff88, #00f2ff);" onclick="window.instantBuy(${medID}, ${p.pharmacyID}, ${p.price_per_unit})">Buy Instantly</button>
                            </div>
                        `).join('')}
                    </div>
                `;
            } else {
                if (instantBuySec) instantBuySec.style.display = 'block';
                panel.innerHTML = `
                    <div style="padding: 2rem; text-align: center; border: 1px dashed var(--border-soft); border-radius: 12px; background: rgba(255,255,255,0.01);">
                        <p style="color: var(--text-muted); font-style: italic; margin-bottom: 0.5rem;">No approved pharmacies currently have this medicine in stock.</p>
                        <p style="font-size: 0.85rem; color: var(--text-muted);">Please search or type another medicine name to find available pharmacies.</p>
                    </div>
                `;
            }
        } catch (err) {
            console.error(err);
            panel.innerHTML = `<p style="color: red;">Error retrieving availability data.</p>`;
        }
    };
    window.instantBuy = async (medID, pharmacyID, price) => {
        try {
            const response = await api.post('/api/orders', {
                medicineID: medID,
                pharmacyID: pharmacyID,
                cost: price,
                auto_buy: true
            });
            const result = await response.json();
            if (response.ok) {
                window.showToast(result.message || 'Instant purchase successful!', 'success');
                if (result.orderID) {
                    window.pushUndo({
                        description: `Purchased medicine (Order #${result.orderID})`,
                        undo: async () => {
                            await api.post(`/api/orders/${result.orderID}/undo`);
                            loadModule('myOrders');
                        }
                    });
                }
                loadModule('myOrders');
            } else {
                window.showToast(result.error || 'Failed to complete instant purchase.', 'error');
            }
        } catch (err) {
            console.error(err);
            window.showToast('Network or server error completing instant purchase.', 'error');
        }

    };

    window.handlePharmaRestockMedChange = async (medID) => {
        const usageInfo = document.getElementById('pharmaMedUsageInfo');
        const resultsDiv = document.getElementById('pharmaRestockResults');
        
        if (!medID) {
            if (usageInfo) usageInfo.style.display = 'none';
            if (resultsDiv) resultsDiv.innerHTML = '';
            return;
        }

        const med = (window.pharmacistMedicines || []).find(m => m.medicineID == medID);
        if (med && usageInfo) {
            usageInfo.innerHTML = `
                <h4 style="color: var(--primary-blue); margin-bottom: 0.4rem; font-size: 1.05rem; letter-spacing: 0.5px;">About ${med.name}</h4>
                <p style="font-size: 0.9rem; color: var(--text-main); margin: 0 0 0.3rem 0;"><strong>What it does:</strong> ${med.used_for || 'General use / category unspecified.'}</p>
                ${med.general_expiry_date ? `<p style="font-size: 0.8rem; color: var(--text-muted); margin: 0;">Standard Expiry Limit: ${med.general_expiry_date.split('T')[0]}</p>` : ''}
            `;
            usageInfo.style.display = 'block';
        } else if (usageInfo) {
            usageInfo.style.display = 'none';
        }

        if (resultsDiv) {
            resultsDiv.innerHTML = '<p style="color: var(--text-muted);">Filtering and comparing prices for restocking...</p>';
        }
        
        try {
            const supplies = (window.pharmacistAvailableSupplies || []).filter(s => s.medicineID == medID);
            
            if (supplies.length === 0) {
                if (resultsDiv) {
                    resultsDiv.innerHTML = '<p style="color: var(--text-muted); font-style: italic; font-size: 0.95rem; margin-top: 1rem;">No available stock for this medicine from any supplier or other pharmacy.</p>';
                }
                return;
            }

            supplies.sort((a, b) => Number(a.price_per_unit) - Number(b.price_per_unit));

            if (resultsDiv) {
                resultsDiv.innerHTML = `
                    <div style="margin-top: 1.5rem;">
                        <h4 style="color: var(--text-main); margin-bottom: 1rem; font-size: 1.1rem; border-bottom: 1px solid var(--border-soft); padding-bottom: 0.5rem; text-transform: uppercase; letter-spacing: 0.5px;">Available Supply Sources (Cheapest first)</h4>
                        <div class="availability-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 1rem;">
                            ${supplies.map((s, idx) => {
                                const uniqueInputId = `restock-qty-${s.supplier_type}-${s.sourceID}-${idx}`;
                                return `
                                    <div class="stat-card" style="display: flex; flex-direction: column; justify-content: space-between; border: 1px solid var(--border-soft); padding: 1.2rem; border-radius: 12px; background: #fbfbfc; transition: all 0.3s ease;">
                                        <div>
                                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 0.4rem;">
                                                <h5 style="color: var(--primary-blue); margin: 0; font-size: 1.05rem;">${s.supplier_name}</h5>
                                                <span class="status-tag" style="background: ${s.supplier_type === 'supplier' ? 'rgba(0, 91, 150, 0.1)' : 'rgba(255, 71, 87, 0.1)'}; color: ${s.supplier_type === 'supplier' ? 'var(--primary-blue)' : '#ff4757'}; border: 1px solid ${s.supplier_type === 'supplier' ? 'rgba(0, 91, 150, 0.2)' : 'rgba(255, 71, 87, 0.2)'}; font-size: 0.75rem; text-transform: uppercase; padding: 0.1rem 0.4rem; border-radius: 4px;">
                                                    ${s.supplier_type}
                                                </span>
                                            </div>
                                            <p style="font-size: 0.85rem; color: var(--text-main); margin-bottom: 0.8rem;"><strong>${s.medicine_name}</strong>${s.general_expiry_date ? ` <span style="font-size:0.75rem;opacity:0.7;">(Exp: ${s.general_expiry_date.split('T')[0]})</span>` : ''}</p>
                                            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.2rem;">
                                                <div>
                                                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block; text-transform: uppercase;">Price per unit</span>
                                                    <span style="font-size: 1.25rem; color: var(--success); font-weight: bold; text-shadow: 0 0 8px rgba(0, 255, 136, 0.2);">$${Number(s.price_per_unit).toFixed(2)}</span>
                                                </div>
                                                <div style="text-align: right;">
                                                    <span style="font-size: 0.75rem; color: var(--text-muted); display: block; text-transform: uppercase;">Available Stock</span>
                                                    <span style="font-size: 0.95rem; color: var(--text-main); font-weight: 600;">${s.quantity} units</span>
                                                </div>
                                            </div>
                                        </div>
                                        <div style="display: flex; gap: 0.5rem; align-items: center;">
                                            <input type="number" id="${uniqueInputId}" placeholder="Qty" min="1" max="${s.quantity}" style="width: 80px; padding: 0.6rem; background: #fbfbfc; border: 1px solid var(--border-soft); border-radius: 8px; color: var(--text-main); text-align: center; margin: 0; min-height: auto; height: 38px;" value="1">
                                            <button class="btn-primary" style="flex: 1; padding: 0.6rem 0.8rem; font-size: 0.8rem; margin: 0; background: linear-gradient(45deg, #00ff88, #00f2ff); min-height: auto; height: 38px; display: flex; align-items: center; justify-content: center;" onclick="window.executePharmaRestock('${s.supplier_type}', ${s.sourceID}, ${medID}, '${uniqueInputId}')">Restock Instantly</button>
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                `;
            }
        } catch (err) {
            console.error(err);
            if (resultsDiv) {
                resultsDiv.innerHTML = '<p style="color: #ff4757;">Failed to load restock options.</p>';
            }
        }
    };

    window.executePharmaRestock = async (sourceType, sourceID, medicineID, qtyInputId) => {
        const qtyInput = document.getElementById(qtyInputId);
        if (!qtyInput) return;
        const qty = parseInt(qtyInput.value, 10);
        if (isNaN(qty) || qty <= 0) {
            window.showToast('Please enter a valid positive quantity.', 'error');
            return;
        }
        
        try {
            const res = await api.post('/api/pharmacist/restock', {
                pharmacyID: selectedPharmacyID,
                medicineID,
                quantity: qty,
                sourceType,
                sourceID
            });
            const data = await res.json();
            if (res.ok) {
                window.showToast(data.message || 'Restocking transfer successful.', 'success');
                if (data.orderID) {
                    window.pushUndo({
                        description: `Restocked ${qty} units (Order #${data.orderID})`,
                        undo: async () => {
                            await api.post(`/api/pharmacist/restock/${data.orderID}/undo`);
                            loadModule('inventory');
                        }
                    });
                }
                loadModule('inventory');
            } else {
                window.showToast(data.error || 'Restocking failed.', 'error');
            }
        } catch (err) {
            console.error(err);
            window.showToast('Error execution failed.', 'error');
        }
    };

    window.updateSupplierStock = async (medicineID) => {
        const qtyInput = document.getElementById(`sqty-${medicineID}`);
        const priceInput = document.getElementById(`sprice-${medicineID}`);
        if (!qtyInput || !priceInput) return;
        
        const qty = parseInt(qtyInput.value, 10);
        const price = parseFloat(priceInput.value);
        
        if (isNaN(qty) || qty < 0) {
            window.showToast('Please enter a valid non-negative quantity.', 'error');
            return;
        }
        if (isNaN(price) || price < 0) {
            window.showToast('Please enter a valid non-negative price.', 'error');
            return;
        }

        const prevQty = qtyInput.defaultValue;
        const prevPrice = priceInput.defaultValue;

        try {
            const res = await api.patch('/api/supplier/stock', {
                medicineID,
                quantity: qty,
                price: price
            });
            const data = await res.json();
            if (res.ok) {
                window.showToast(data.message || 'Stock updated successfully.', 'success');
                window.pushUndo({
                    description: `Updated supplier stock of medicine #${medicineID}`,
                    undo: async () => {
                        await api.patch('/api/supplier/stock', {
                            medicineID,
                            quantity: prevQty,
                            price: prevPrice
                        });
                        loadModule('supplier_stock');
                    }
                });
                loadModule('supplier_stock');
            } else {
                window.showToast(data.error || 'Failed to update stock.', 'error');
            }
        } catch (err) {
            console.error(err);
            window.showToast('Error updating stock.', 'error');
        }
    };

    window.addEventListener('popstate', (event) => {
        if (event.state) {
            if (event.state.type === 'view') {
                window.showPage(event.state.page, false);
            } else if (event.state.type === 'module') {
                window.loadModule(event.state.moduleId, false);
            }
        } else {
            // Default to landing page if no state
            window.showPage('landingPage', false);
        }
    });

    if (token) {
        initApp();
        // Set initial history state
        history.replaceState({ page: 'mainApp', type: 'view' }, '', '#mainApp');
    } else {
        showPage('landingPage', false);
        history.replaceState({ page: 'landingPage', type: 'view' }, '', '#landingPage');
    }
});
