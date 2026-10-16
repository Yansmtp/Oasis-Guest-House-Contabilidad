// Desarrollo local: siempre usa backend en localhost:3000 a menos que window.API_BASE_URL se sobreescriba manualmente.
const API_BASE_URL = (typeof window !== 'undefined' && window.API_BASE_URL)
  ? window.API_BASE_URL
  : 'http://localhost:3000/api';
let currentUser = null;
let currentPage = 1;

const BRAND_LOGO_ASSETS = {
    dark: 'img/logo-light.png',
    light: 'img/logo-dark.png',
    default: 'img/logo.png'
};
const openModals = [];

function applyContextBrandLogos(root = document) {
    const logos = root.querySelectorAll('img[data-logo-bg]');
    logos.forEach((logo) => {
        const backgroundTone = String(logo.dataset.logoBg || '').toLowerCase();
        const preferredLogo = BRAND_LOGO_ASSETS[backgroundTone] || BRAND_LOGO_ASSETS.default;
        const fallbackLogo = BRAND_LOGO_ASSETS.default;
        const originalOnError = logo.onerror;

        logo.onerror = () => {
            if (logo.src.includes(fallbackLogo)) {
                if (typeof originalOnError === 'function') originalOnError.call(logo);
                return;
            }
            logo.onerror = originalOnError || null;
            logo.src = fallbackLogo;
        };

        logo.src = preferredLogo;
    });
}

// Utilidades de autenticación
function getToken() {
    return localStorage.getItem('token');
}

function setToken(token) {
    localStorage.setItem('token', token);
}

function removeToken() {
    localStorage.removeItem('token');
}

function setCurrentUser(user) {
    currentUser = user;
    localStorage.setItem('user', JSON.stringify(user));
}

function getCurrentUser() {
    if (!currentUser) {
        const userStr = localStorage.getItem('user');
        if (userStr) {
            currentUser = JSON.parse(userStr);
        }
    }
    return currentUser;
}

function clearCurrentUser() {
    currentUser = null;
    localStorage.removeItem('user');
}

// Utilidades de API
async function apiRequest(endpoint, options = {}) {
    const suppressErrorAlert = !!options.suppressErrorAlert;
    const token = getToken();
    const headers = {
        'Content-Type': 'application/json',
        ...options.headers,
    };

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const url = `${API_BASE_URL}${endpoint}`;
    
    try {
        const response = await fetch(url, {
            ...options,
            headers,
        });

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        const isJsonResponse = contentType.includes('application/json');

        const readBody = async () => {
            if (isJsonResponse) {
                return await response.json();
            }
            return { rawText: await response.text() };
        };

        if (!response.ok) {
            if (response.status === 401) {
                logout();
                throw new Error('Sesion expirada. Por favor, inicie sesion nuevamente.');
            }

            const errorBody = await readBody().catch(() => ({}));
            const rawMessage = (errorBody && typeof errorBody === 'object')
                ? (errorBody.message || errorBody.error || errorBody.rawText || '')
                : '';
            const compactMessage = String(rawMessage)
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 180);

            throw new Error(compactMessage || `Error ${response.status}: ${response.statusText}`);
        }

        const data = await readBody();
        if (!isJsonResponse) {
            const preview = String(data?.rawText || '')
                .replace(/<[^>]*>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
            throw new Error(`Respuesta no JSON desde ${url}${preview ? `: ${preview}` : ''}`);
        }

        return data;
    } catch (error) {
        console.error('API Request Error:', error);
        if (!suppressErrorAlert) {
            showAlert(error.message || 'Error de conexion', 'error');
        }
        throw error;
    }
}
// Utilidades de interfaz
function showAlert(message, type = 'info') {
    // Remover alertas anteriores
    const existingAlerts = document.querySelectorAll('.alert');
    existingAlerts.forEach(alert => alert.remove());

    const alert = document.createElement('div');
    alert.className = `alert alert-${type}`;
    alert.innerHTML = `
        <i class="fas fa-${getAlertIcon(type)}"></i>
        <span>${message}</span>
    `;
    
    const container = document.querySelector('.container') || document.body;
    container.insertBefore(alert, container.firstChild);
    
    // Auto-remover después de 5 segundos
    setTimeout(() => {
        if (alert.parentNode) {
            alert.remove();
        }
    }, 5000);
}

function getAlertIcon(type) {
    const icons = {
        'success': 'check-circle',
        'error': 'exclamation-circle',
        'warning': 'exclamation-triangle',
        'info': 'info-circle'
    };
    return icons[type] || 'info-circle';
}

function showLoading(elementId = null) {
    const target = elementId ? document.getElementById(elementId) : document.body;
    if (target) {
        const spinner = document.createElement('div');
        spinner.className = 'spinner';
        spinner.id = 'loading-spinner';
        target.appendChild(spinner);
    }
}

function hideLoading() {
    const spinner = document.getElementById('loading-spinner');
    if (spinner && spinner.parentNode) {
        spinner.remove();
    }
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    return date.toLocaleDateString('es-ES', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// Parse a numeric value from a variety of inputs (numbers, strings with thousand separators, currency strings, Prisma.Decimals, etc.)
function parseNumberSafe(value) {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    // Prisma Decimal often has toNumber method
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
        try { return value.toNumber(); } catch (e) { /* noop */ }
    }

    let s = String(value).trim();
    // Remove currency symbols and letters
    s = s.replace(/[^0-9\-.,]/g, '');

    // If both dot and comma exist, assume dot is thousand separator and comma decimal
    if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) {
        // Only comma exists, treat as decimal separator
        s = s.replace(',', '.');
    } else {
        // Only dots or only digits - keep as-is
    }

    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
}

function formatCurrency(amount, currencyCode = 'USD') {
    const n = parseNumberSafe(amount) || 0;
    const normalizedCode = (currencyCode || 'USD').toUpperCase();
    try {
        return new Intl.NumberFormat('es-ES', {
            style: 'currency',
            currency: normalizedCode,
            minimumFractionDigits: 2
        }).format(n);
    } catch (e) {
        return `${normalizedCode} ${formatNumber(n)}`;
    }
}

function isAdmin() {
    const user = getCurrentUser();
    return String(user?.role || '').toUpperCase() === 'ADMIN';
}

function formatNumber(number) {
    return new Intl.NumberFormat('es-ES', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(number);
}

const COMPACT_LIST_MEDIA = typeof window !== 'undefined'
    ? window.matchMedia('(max-width: 991px)')
    : null;

function isCompactListView() {
    return COMPACT_LIST_MEDIA ? COMPACT_LIST_MEDIA.matches : false;
}

/** Reportes: scroll horizontal en pantallas pequeñas (sin tarjetas por campo). */
function refreshResponsiveTables(root) {
    const scope = root && root.querySelectorAll ? root : document;
    if (!scope.querySelectorAll) return;

    scope.querySelectorAll(
        '.movements-report-output .table, #report-content .table, #client-report-result .table, #movement-report-result .table'
    ).forEach((table) => {
        table.classList.remove('table-mobile-stack');
        const wrap = table.closest('.table-responsive');
        if (wrap) wrap.classList.add('table-report-scroll');
    });
}

function initCompactListResponsive() {
    if (window.__compactListResponsiveInit || !COMPACT_LIST_MEDIA) return;
    window.__compactListResponsiveInit = true;

    let timer = null;
    const rerunVisibleLists = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            const productsSection = document.getElementById('products');
            if (productsSection?.style.display !== 'none' && typeof renderProductsTable === 'function') {
                renderProductsTable();
            }
            const movementsSection = document.getElementById('movements');
            if (movementsSection?.style.display !== 'none' && typeof renderMovementsTable === 'function') {
                renderMovementsTable();
            }
            const clientsSection = document.getElementById('clients');
            if (clientsSection?.style.display !== 'none' && typeof renderClientsTable === 'function') {
                renderClientsTable();
            }
            const costCentersSection = document.getElementById('cost-centers');
            if (costCentersSection?.style.display !== 'none' && typeof renderCostCentersTable === 'function') {
                renderCostCentersTable();
            }
            const dashboardSection = document.getElementById('dashboard');
            if (dashboardSection?.style.display !== 'none' && typeof loadRecentMovements === 'function') {
                loadRecentMovements();
            }
            const companySection = document.getElementById('company');
            if (companySection?.style.display !== 'none' && typeof loadUsers === 'function') {
                loadUsers();
            }
        }, 220);
    };

    COMPACT_LIST_MEDIA.addEventListener('change', rerunVisibleLists);
    window.addEventListener('resize', rerunVisibleLists);
}

function toggleNavbar() {
    const navbarMenu = document.getElementById('navbar-menu');
    navbarMenu.classList.toggle('show');
    document.body.classList.toggle('navbar-open', navbarMenu.classList.contains('show'));
}

function closeNavbar() {
    const navbarMenu = document.getElementById('navbar-menu');
    navbarMenu.classList.remove('show');
    document.body.classList.remove('navbar-open');
}

// Marcar item activo del menú
function setActiveMenu(sectionId) {
    const links = document.querySelectorAll('.nav-link');
    links.forEach(l => l.classList.remove('active'));

    // Buscar por data-section
    let activeLink = document.querySelector(`.nav-link[data-section="${sectionId}"]`);

    // Fallback: buscar por href que incluya el id
    if (!activeLink) {
        activeLink = Array.from(links).find(l => {
            const href = (l.getAttribute('href') || '').toLowerCase();
            if (href.includes(sectionId)) return true;

            const text = (l.textContent || '').toLowerCase();
            if (text.includes(sectionId.replace('-', ' '))) return true;

            // Mapeos comunes (español -> id)
            const mapping = {
                'products': 'productos',
                'dashboard': 'dashboard',
                'movements': 'movimientos',
                'clients': 'clientes',
                'cost-centers': 'centros',
                'company': 'empresa',
                'admin': 'administrativo'
            };

            if (mapping[sectionId] && text.includes(mapping[sectionId])) return true;

            return false;
        });
    }

    if (activeLink) {
        activeLink.classList.add('active');
    }
}

// Wrapper fetch con autenticación (compatibilidad con admin.js)
async function fetchWithAuth(endpoint, options = {}) {
    return await apiRequest(endpoint, options);
}

// Exponer funciones globalmente por compatibilidad
window.setActiveMenu = setActiveMenu;
window.fetchWithAuth = fetchWithAuth;
window.parseNumberSafe = parseNumberSafe;
window.isAdmin = isAdmin;
window.refreshResponsiveTables = refreshResponsiveTables;
window.isCompactListView = isCompactListView;
window.initCompactListResponsive = initCompactListResponsive;

// Utilidades de modal
function showModal(modalId) {
    const modal = document.getElementById(modalId);
    const overlay = document.getElementById('modal-overlay');
    if (!modal || !overlay) return;

    if (!openModals.includes(modalId)) {
        openModals.push(modalId);
    }

    overlay.style.display = 'block';
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
}

function closeModal(modalId = null) {
    const overlay = document.getElementById('modal-overlay');

    if (modalId) {
        const modal = document.getElementById(modalId);
        if (modal) modal.style.display = 'none';
        const idx = openModals.indexOf(modalId);
        if (idx !== -1) openModals.splice(idx, 1);
    } else {
        document.querySelectorAll('.modal').forEach(modal => modal.style.display = 'none');
        openModals.length = 0;
    }

    if (openModals.length === 0) {
        if (overlay) overlay.style.display = 'none';
        document.body.style.overflow = 'auto';
    } else {
        if (overlay) overlay.style.display = 'block';
        document.body.style.overflow = 'hidden';
    }
}

// Utilidades de formulario
function validateForm(formId) {
    const form = document.getElementById(formId);
    const inputs = form.querySelectorAll('[required]');
    let isValid = true;

    inputs.forEach(input => {
        if (!input.value.trim()) {
            input.style.borderColor = 'var(--danger-color)';
            isValid = false;
        } else {
            input.style.borderColor = '';
        }
    });

    return isValid;
}

function resetForm(formId) {
    const form = document.getElementById(formId);
    if (form) {
        form.reset();
        // Limpiar estilos de validación
        const inputs = form.querySelectorAll('input, select, textarea');
        inputs.forEach(input => {
            input.style.borderColor = '';
        });
    }
}

// Utilidades de paginación
function createPagination(containerId, currentPage, totalPages, callback) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';
    
    if (totalPages <= 1) return;

    // Botón anterior
    const prevButton = document.createElement('button');
    prevButton.innerHTML = '&laquo;';
    prevButton.disabled = currentPage === 1;
    prevButton.onclick = () => callback(currentPage - 1);
    container.appendChild(prevButton);

    // Números de página
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);

    for (let i = startPage; i <= endPage; i++) {
        const pageButton = document.createElement('button');
        pageButton.textContent = i;
        pageButton.className = i === currentPage ? 'active' : '';
        pageButton.onclick = () => callback(i);
        container.appendChild(pageButton);
    }

    // Botón siguiente
    const nextButton = document.createElement('button');
    nextButton.innerHTML = '&raquo;';
    nextButton.disabled = currentPage === totalPages;
    nextButton.onclick = () => callback(currentPage + 1);
    container.appendChild(nextButton);
}

// Utilidades de tabla
function createTableRow(data, columns, actions = []) {
    const row = document.createElement('tr');
    
    columns.forEach(column => {
        const cell = document.createElement('td');
        
        if (typeof column === 'string') {
            cell.textContent = data[column] || '';
        } else if (typeof column === 'function') {
            cell.innerHTML = column(data);
        } else if (column.field) {
            if (column.formatter) {
                cell.innerHTML = column.formatter(data[column.field], data);
            } else {
                cell.textContent = data[column.field] || '';
            }
        }
        
        row.appendChild(cell);
    });

    if (actions.length > 0) {
        const actionCell = document.createElement('td');
        actionCell.className = 'actions';
        
        actions.forEach(action => {
            const button = document.createElement('button');
            button.className = `btn btn-sm ${action.class || 'btn-outline'}`;
            button.innerHTML = action.icon ? `<i class="fas fa-${action.icon}"></i>` : action.text;
            button.title = action.title || '';
            button.onclick = () => action.handler(data);
            actionCell.appendChild(button);
        });
        
        row.appendChild(actionCell);
    }

    return row;
}

// Utilidades de exportación
function exportToCSV(data, filename) {
    if (!data || data.length === 0) return;

    const headers = Object.keys(data[0]);
    const csvContent = [
        headers.join(','),
        ...data.map(row => 
            headers.map(header => {
                const value = row[header];
                return typeof value === 'string' ? `"${value.replace(/"/g, '""')}"` : value;
            }).join(',')
        )
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function printElement(elementId) {
    const element = document.getElementById(elementId);
    if (!element) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Impresión</title>
                <link rel="stylesheet" href="css/print.css">
                <style>
                    body { font-family: Arial, sans-serif; }
                    .no-print { display: none; }
                </style>
            </head>
            <body>
                ${element.innerHTML}
            </body>
        </html>
    `);
    
    printWindow.document.close();
    printWindow.focus();
    
    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 250);
}

// Verificar que las secciones referenciadas en el menú existan
function verifySectionsExist() {
    const links = document.querySelectorAll('.nav-link[data-section]');
    const missing = [];

    links.forEach(link => {
        const sectionId = link.dataset.section;
        if (!sectionId) return;

        const sectionElem = document.getElementById(sectionId);
        if (!sectionElem) {
            missing.push(sectionId);
            link.classList.add('missing-section');
            link.title = `Sección "${sectionId}" no encontrada`;

            if (!link.querySelector('.warn-icon')) {
                const span = document.createElement('span');
                span.className = 'warn-icon text-warning ms-1';
                span.innerHTML = '<i class="fas fa-exclamation-circle"></i>';
                link.appendChild(span);
            }
        } else {
            link.classList.remove('missing-section');
            const warn = link.querySelector('.warn-icon');
            if (warn) warn.remove();
        }
    });

    if (missing.length > 0) {
        console.warn('Secciones faltantes en el DOM:', missing);
        // Mostrar alerta amigable
        try {
            showAlert(`Faltan secciones del UI: ${missing.join(', ')}`, 'warning');
        } catch (e) {
            // noop
        }
    }
}

window.verifySectionsExist = verifySectionsExist;
window.applyContextBrandLogos = applyContextBrandLogos;

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    applyContextBrandLogos();

    // Cerrar navbar al hacer clic fuera
    document.addEventListener('click', (e) => {
        if (!e.target.closest('.navbar') && !e.target.closest('.navbar-toggle')) {
            closeNavbar();
        }
    });

    // Cerrar modal al presionar ESC
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeModal();
        }
    });

    // Verificar autenticación al cargar
    checkAuth();
});

// Comprobar autenticación
function checkAuth() {
    const token = getToken();
    const user = getCurrentUser();
    
    if (token && user) {
        showMainApp();
        loadDashboard();
    } else {
        showLogin();
    }
}
