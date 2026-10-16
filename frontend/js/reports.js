// Fallback in case utils.js did not attach parseNumberSafe yet.
var parseNumberSafe = window.parseNumberSafe || function (value) {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
        try { return value.toNumber(); } catch (e) { /* noop */ }
    }
    let s = String(value).trim();
    s = s.replace(/[^0-9\-.,]/g, '');
    if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
        s = s.replace(/\./g, '').replace(',', '.');
    } else if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) {
        s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
};

async function loadCurrencyOptions(selectId, selectedCode = 'USD') {
    try {
        const response = await apiRequest('/currencies');
        const list = response?.data || [];
        const select = document.getElementById(selectId);
        if (!select) return;

        select.innerHTML = '';
        list.forEach(c => {
            const option = document.createElement('option');
            option.value = c.code;
            option.textContent = `${c.code} - ${c.name}`;
            if (c.code === selectedCode || (c.isDefault && !selectedCode)) {
                option.selected = true;
            }
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading currencies:', error);
    }
}

function normalizeLogoUrl(logoPath) {
    if (!logoPath) return null;
    const backendBase = (typeof API_BASE_URL !== 'undefined')
        ? API_BASE_URL.replace(/\/api\/?$/, '')
        : `${window.location.protocol}//${window.location.hostname}:3000`;

    if (/^https?:\/\//i.test(logoPath)) {
        const u = new URL(logoPath);
        if (!u.pathname.startsWith('/uploads/')) return null;
        return `${u.origin}${u.pathname}`;
    }

    const normalized = String(logoPath).replace(/\\/g, '/');
    if (normalized.startsWith('/uploads/')) {
        return `${backendBase}${normalized}`;
    }
    if (normalized.includes('/uploads/')) {
        return `${backendBase}${normalized.substring(normalized.indexOf('/uploads/'))}`;
    }

    return null;
}

async function getCompanyLogoUrl() {
    try {
        const company = await apiRequest('/company');
        const logoUrl = normalizeLogoUrl(company?.logo);
        if (!logoUrl) return null;
        const cacheKey = company?.updatedAt ? new Date(company.updatedAt).getTime() : Date.now();
        return `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}v=${cacheKey}`;
    } catch (error) {
        console.warn('getCompanyLogoUrl: no se pudo cargar el logo', error);
        return null;
    }
}

function formatExchangeRateHeader(exchangeRateInfo) {
    if (!exchangeRateInfo) return '';
    const usdToCup = parseNumberSafe(exchangeRateInfo.usdToCup);
    const cupToUsd = parseNumberSafe(exchangeRateInfo.cupToUsd);
    if (!usdToCup || !cupToUsd) return '';
    const atText = exchangeRateInfo.at ? formatDate(exchangeRateInfo.at) : '';
    return `
        <p class="text-muted mb-2">
            Tasa usada: 1 USD = ${formatNumber(usdToCup)} CUP | 1 CUP = ${formatNumber(cupToUsd)} USD
            ${atText ? `(${atText})` : ''}
        </p>
    `;
}

function formatCurrencyWithEquivalent(amount, currencyCode, exchangeRateInfo) {
    const code = String(currencyCode || 'USD').toUpperCase();
    const base = formatCurrency(amount, code);
    if (!exchangeRateInfo) return `<span class="report-currency">${base}</span>`;

    const usdToCup = parseNumberSafe(exchangeRateInfo.usdToCup);
    const cupToUsd = parseNumberSafe(exchangeRateInfo.cupToUsd);
    if (!usdToCup || !cupToUsd) return `<span class="report-currency">${base}</span>`;

    if (code === 'USD') {
        const cup = parseNumberSafe(amount) * usdToCup;
        return `<span class="report-currency cell-currency-stack"><span>${base}</span><small>CUP: ${formatCurrency(cup, 'CUP')}</small></span>`;
    }
    if (code === 'CUP') {
        const usd = parseNumberSafe(amount) * cupToUsd;
        return `<span class="report-currency cell-currency-stack"><span>${base}</span><small>USD: ${formatCurrency(usd, 'USD')}</small></span>`;
    }
    return `<span class="report-currency">${base}</span>`;
}

async function loadSelectOptionsFromApi(selectId, endpoint, placeholder) {
    try {
        const response = await apiRequest(endpoint) || {};
        const list = Array.isArray(response.data) ? response.data : [];
        const select = document.getElementById(selectId);
        if (!select) return;
        select.innerHTML = `<option value="">${placeholder}</option>`;
        list.forEach(item => {
            const option = document.createElement('option');
            option.value = String(item.id);
            option.textContent = `${item.code || ''} - ${item.name || ''}`.trim();
            select.appendChild(option);
        });
    } catch (error) {
        console.error(`Error loading options for ${selectId}:`, error);
    }
}

function getMovementReportTypeLabel(type) {
    if (type === 'ENTRADA') return 'Entradas';
    if (type === 'SALIDA') return 'Salidas';
    return 'Entradas y Salidas';
}

let lastMovementsReportContext = null;

function getInvoiceCounterStorageKey(year2Digits) {
    return `oasis_invoice_seq_${year2Digits}`;
}

function nextInvoiceNumber() {
    const now = new Date();
    const year2 = String(now.getFullYear()).slice(-2);
    const key = getInvoiceCounterStorageKey(year2);
    const current = parseInt(localStorage.getItem(key) || '0', 10);
    const next = Number.isFinite(current) ? current + 1 : 1;
    localStorage.setItem(key, String(next));
    return `FCT${year2}${String(next).padStart(4, '0')}`;
}

async function getCompanyInfoSafe() {
    try {
        const company = await apiRequest('/company');
        return company || {};
    } catch (error) {
        console.warn('No se pudo cargar info de empresa para factura', error);
        return {};
    }
}

function applyMovementReportFilterRules() {
    const typeEl = document.getElementById('movement-report-type');
    const clientEl = document.getElementById('movement-report-client');
    const costCenterEl = document.getElementById('movement-report-cost-center');
    const clientLabel = document.getElementById('movement-report-client-label');
    const costCenterLabel = document.getElementById('movement-report-cost-center-label');
    const helperEl = document.getElementById('movement-report-filter-helper');
    if (!typeEl || !clientEl || !costCenterEl) return;

    const type = typeEl.value || '';

    clientEl.disabled = false;
    costCenterEl.disabled = false;

    if (type === 'ENTRADA') {
        costCenterEl.value = '';
        costCenterEl.disabled = true;
        if (clientLabel) clientLabel.textContent = 'Proveedor (Cliente)';
        if (costCenterLabel) costCenterLabel.textContent = 'Centro de Costo (No aplica para Entradas)';
        if (helperEl) helperEl.textContent = 'En Entradas solo se filtra por proveedor.';
        return;
    }

    if (type === 'SALIDA') {
        clientEl.value = '';
        clientEl.disabled = true;
        if (clientLabel) clientLabel.textContent = 'Proveedor (No aplica para Salidas)';
        if (costCenterLabel) costCenterLabel.textContent = 'Centro de Costo';
        if (helperEl) helperEl.textContent = 'En Salidas solo se filtra por centro de costo.';
        return;
    }

    if (clientLabel) clientLabel.textContent = 'Proveedor (Cliente)';
    if (costCenterLabel) costCenterLabel.textContent = 'Centro de Costo';
    if (helperEl) helperEl.textContent = 'En reporte total puede usar ambos filtros.';
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function mountReportHtml(elementId, html) {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.innerHTML = html;
    if (typeof refreshResponsiveTables === 'function') {
        refreshResponsiveTables(el);
    }
}

function downloadExcelHtml(filename, htmlBody) {
    const excelHtml = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office"
              xmlns:x="urn:schemas-microsoft-com:office:excel"
              xmlns="http://www.w3.org/TR/REC-html40">
            <head>
                <meta charset="UTF-8">
                <!--[if gte mso 9]><xml>
                <x:ExcelWorkbook>
                    <x:ExcelWorksheets>
                        <x:ExcelWorksheet>
                            <x:Name>Reporte</x:Name>
                            <x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>
                        </x:ExcelWorksheet>
                    </x:ExcelWorksheets>
                </x:ExcelWorkbook>
                </xml><![endif]-->
                <style>
                    table { border-collapse: collapse; width: 100%; }
                    th, td { border: 1px solid #d0d0d0; padding: 6px; font-size: 12px; }
                    th { background: #f2f5f9; font-weight: 700; }
                    .title { font-size: 16px; font-weight: 700; }
                    .subtitle { font-size: 12px; color: #444; }
                </style>
            </head>
            <body>${htmlBody}</body>
        </html>
    `;

    const blob = new Blob([excelHtml], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `${filename}.xls`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

async function downloadExcelFromApi(endpoint, filenameFallback = 'reporte.xlsx') {
    const token = (typeof getToken === 'function') ? getToken() : localStorage.getItem('token');
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const response = await fetch(`${API_BASE_URL}${endpoint}`, { method: 'GET', headers });
    if (!response.ok) {
        let message = `Error ${response.status}`;
        try {
            const json = await response.json();
            message = json.message || message;
        } catch (e) {
            // noop
        }
        throw new Error(message);
    }

    const blob = await response.blob();
    const contentDisposition = response.headers.get('content-disposition') || '';
    const match = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
    const filename = match?.[1] || filenameFallback;

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

// Mostrar reporte de stock
async function showStockReport(currencyCode = 'USD') {
    try {
        showLoading('report-content');
        
        const response = await apiRequest(`/reports/stock?currency=${encodeURIComponent(currencyCode)}`) || {};
        // apiRequest sometimes wraps result in { data: ... }
        const data = response.data || response || {};
        const summary = data.summary || {};
        const lowStockProducts = data.lowStockProducts || [];
        const products = data.products || [];
        
        const html = `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-boxes"></i> Reporte de Inventario</h3>
                    <div class="d-flex gap-2 align-items-center">
                        <select id="stock-report-currency" class="form-control no-print">
                        </select>
                        <button class="btn btn-primary" onclick="printStockReport()">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                    </div>
                </div>
                <div class="card-body">
                    ${formatExchangeRateHeader(summary.exchangeRateInfo)}
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon bg-primary">
                                <i class="fas fa-boxes"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalProducts ?? 0}</h3>
                                <p>Productos Totales</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-danger">
                                <i class="fas fa-exclamation-triangle"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.lowStockCount ?? 0}</h3>
                                <p>Bajo Stock</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-success">
                                <i class="fas fa-dollar-sign"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${formatCurrencyWithEquivalent(summary.totalValue ?? 0, summary.currency || currencyCode, summary.exchangeRateInfo)}</h3>
                                <p>Valor Total</p>
                            </div>
                        </div>
                    </div>
                    
                    <h4>Productos Bajo Stock</h4>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Código</th>
                                    <th>Producto</th>
                                    <th>Unidad</th>
                                    <th>Stock Actual</th>
                                    <th>Stock Mínimo</th>
                                    <th>Costo Unit.</th>
                                    <th>Valor Total</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${lowStockProducts.map(product => `
                                    <tr class="table-danger">
                                        <td>${product?.code || ''}</td>
                                        <td>${product?.name || ''}</td>
                                        <td>${formatUnit(product?.unit)}</td>
                                        <td>${formatNumber(product?.stock || 0)}</td>
                                        <td>${formatNumber(product?.minStock || 0)}</td>
                                        <td>${formatCurrencyWithEquivalent((product?.unitCostReport !== undefined ? product.unitCostReport : product?.unitCost) || 0, summary.currency || currencyCode, summary.exchangeRateInfo)}</td>
                                        <td>${formatCurrencyWithEquivalent((product?.totalValueReport !== undefined ? product.totalValueReport : (product?.stock || 0) * (product?.unitCost || 0)), summary.currency || currencyCode, summary.exchangeRateInfo)}</td>
                                        <td>
                                            <span class="status-badge status-low">
                                                Bajo Stock
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <h4>Inventario Completo</h4>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Código</th>
                                    <th>Producto</th>
                                    <th>Unidad</th>
                                    <th>Stock</th>
                                    <th>Stock Mín.</th>
                                    <th>Stock Máx.</th>
                                    <th>Costo Unit.</th>
                                    <th>Valor Total</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${products.map(product => `
                                    <tr ${(parseNumberSafe(product?.stock || 0)) <= (parseNumberSafe(product?.minStock || 0)) ? 'class="table-danger"' : ''}>
                                        <td>${product?.code || ''}</td>
                                        <td>${product?.name || ''}</td>
                                        <td>${formatUnit(product?.unit)}</td>
                                        <td>${formatNumber(product?.stock || 0)}</td>
                                        <td>${formatNumber(product?.minStock || 0)}</td>
                                        <td>${product?.maxStock ? formatNumber(product.maxStock) : '-'}</td>
                                        <td>${formatCurrencyWithEquivalent((product?.unitCostReport !== undefined ? product.unitCostReport : product?.unitCost) || 0, summary.currency || currencyCode, summary.exchangeRateInfo)}</td>
                                        <td>${formatCurrencyWithEquivalent((product?.totalValueReport !== undefined ? product.totalValueReport : (product?.stock || 0) * (product?.unitCost || 0)), summary.currency || currencyCode, summary.exchangeRateInfo)}</td>
                                        <td>
                                            <span class="status-badge ${(parseNumberSafe(product?.stock || 0)) <= (parseNumberSafe(product?.minStock || 0)) ? 'status-low' : 'status-active'}">
                                                ${(parseNumberSafe(product?.stock || 0)) <= (parseNumberSafe(product?.minStock || 0)) ? 'Bajo Stock' : 'Normal'}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        mountReportHtml('report-content', html);
        await loadCurrencyOptions('stock-report-currency', summary.currency || currencyCode);
        const select = document.getElementById('stock-report-currency');
        if (select) {
            select.onchange = () => showStockReport(select.value);
        }
        
    } catch (error) {
        console.error('Error loading stock report:', error);
        showAlert('Error al cargar el reporte de stock', 'error');
    } finally {
        hideLoading();
    }
}

function formatStockForecastStatus(status) {
    if (!status) return 'DESCONOCIDO';
    const labels = {
        OK: 'Normal',
        ATENCION: 'Atención',
        CRITICO: 'Crítico',
        AGOTADO: 'Agotado',
        SIN_CONSUMO: 'Sin Consumo',
    };
    return labels[String(status).toUpperCase()] || String(status);
}

function getStockForecastBadgeClass(status) {
    if (status === 'CRITICO') return 'status-critical';
    if (status === 'ATENCION') return 'status-attention';
    if (status === 'AGOTADO') return 'status-out';
    if (status === 'SIN_CONSUMO') return 'status-none';
    return 'status-normal';
}

function getSelectedStockForecastStatuses() {
    const inputs = document.querySelectorAll('#stock-forecast-status-group input[type="checkbox"]');
    const selected = Array.from(inputs)
        .filter(input => input.checked)
        .map(input => input.value);
    if (selected.includes('all') || selected.length === 0) {
        return ['all'];
    }
    return selected;
}

async function exportStockForecast() {
    try {
        const periodEl = document.getElementById('stock-forecast-period');
        const monthsEl = document.getElementById('stock-forecast-history-months');
        const period = periodEl?.value || 'monthly';
        const historyMonths = parseInt(monthsEl?.value || '3', 10) || 3;
        const statusValues = getSelectedStockForecastStatuses();
        const status = statusValues.includes('all') ? 'all' : statusValues.join(',');
        await downloadExcelFromApi(
            `/reports/stock-forecast/export?period=${encodeURIComponent(period)}&historyMonths=${encodeURIComponent(historyMonths)}&status=${encodeURIComponent(status)}`,
            `stock_forecast_${period}_${historyMonths}_${status}.xlsx`
        );
    } catch (error) {
        console.error('Error exporting stock forecast:', error);
        showAlert('Error al exportar pronóstico de stock', 'error');
    }
}

function setupStockForecastStatusEvents() {
    const inputs = document.querySelectorAll('#stock-forecast-status-group input[type="checkbox"]');
    const allInput = document.querySelector('#stock-forecast-status-group input[value="all"]');
    inputs.forEach(input => {
        input.onchange = () => {
            if (!allInput) return;
            if (input.value === 'all' && input.checked) {
                inputs.forEach(item => {
                    if (item !== allInput) item.checked = false;
                });
                return;
            }
            if (input.value !== 'all' && input.checked) {
                allInput.checked = false;
            }
            const anyChecked = Array.from(inputs)
                .filter(item => item !== allInput)
                .some(item => item.checked);
            if (!anyChecked) {
                allInput.checked = true;
            }
        };
    });
}

function toggleStockForecastFiltersDropdown(forceState) {
    const dropdown = document.getElementById('stock-forecast-filters-dropdown');
    const toggle = document.getElementById('stock-forecast-filter-toggle');
    if (!dropdown || !toggle) return;
    const isOpen = dropdown.classList.contains('open');
    const shouldOpen = typeof forceState === 'boolean' ? forceState : !isOpen;
    dropdown.classList.toggle('open', shouldOpen);
    toggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
}

async function showStockForecast(period = 'monthly', historyMonths = 3, status = ['all']) {
    try {
        const statusValues = Array.isArray(status)
            ? status
            : String(status).split(',').map(item => String(item).trim()).filter(Boolean);
        const effectiveStatus = statusValues.length === 0 ? ['all'] : statusValues;
        const normalizedStatus = effectiveStatus.includes('all') ? ['all'] : Array.from(new Set(effectiveStatus));
        const statusQuery = normalizedStatus.includes('all') ? 'all' : normalizedStatus.join(',');

        showLoading('report-content');
        const response = await apiRequest(`/reports/stock-forecast?period=${encodeURIComponent(period)}&historyMonths=${encodeURIComponent(historyMonths)}&status=${encodeURIComponent(statusQuery)}`) || {};
        const data = response.data || response || {};
        const summary = data.summary || {};
        const products = data.products || [];

        const html = `
            <div class="card">
                <div class="card-header position-relative">
                    <h3><i class="fas fa-chart-line"></i> Pronóstico de Stock</h3>
                    <div class="d-flex flex-wrap gap-2 align-items-center">
                        <button id="stock-forecast-filter-toggle" class="btn btn-outline-secondary" type="button" onclick="toggleStockForecastFiltersDropdown()">
                            <i class="fas fa-filter"></i> Filtros
                        </button>
                        <button class="btn btn-secondary" onclick="showStockForecast(document.getElementById('stock-forecast-period').value, document.getElementById('stock-forecast-history-months').value, getSelectedStockForecastStatuses())">
                            <i class="fas fa-sync"></i> Actualizar
                        </button>
                        <button class="btn btn-primary" onclick="printStockForecast()">
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                        <button class="btn btn-success" onclick="exportStockForecast()">
                            <i class="fas fa-file-excel"></i> Exportar Excel
                        </button>
                    </div>
                    <div id="stock-forecast-filters-dropdown" class="stock-forecast-filters-dropdown">
                        <div class="form-group">
                            <label class="small mb-1">Periodo</label>
                            <select id="stock-forecast-period" class="form-control">
                                <option value="monthly" ${period === 'monthly' ? 'selected' : ''}>Mensual</option>
                                <option value="weekly" ${period === 'weekly' ? 'selected' : ''}>Semanal</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label class="small mb-1">Meses de historial</label>
                            <input type="number" id="stock-forecast-history-months" class="form-control" min="1" max="12" value="${historyMonths}">
                        </div>
                        <div class="form-group mb-0">
                            <label class="small mb-1">Estado</label>
                            <div id="stock-forecast-status-group" class="forecast-status-group">
                                <label class="forecast-status-item">
                                    <input type="checkbox" value="all" ${effectiveStatus.includes('all') ? 'checked' : ''}> Todos
                                </label>
                                <label class="forecast-status-item">
                                    <input type="checkbox" value="AGOTADO" ${effectiveStatus.includes('AGOTADO') ? 'checked' : ''}> Agotados
                                </label>
                                <label class="forecast-status-item">
                                    <input type="checkbox" value="PRONTO" ${effectiveStatus.includes('PRONTO') ? 'checked' : ''}> Pronto a vencerse
                                </label>
                                <label class="forecast-status-item">
                                    <input type="checkbox" value="ATENCION" ${effectiveStatus.includes('ATENCION') ? 'checked' : ''}> Atención
                                </label>
                                <label class="forecast-status-item">
                                    <input type="checkbox" value="CRITICO" ${effectiveStatus.includes('CRITICO') ? 'checked' : ''}> Crítico
                                </label>
                                <label class="forecast-status-item">
                                    <input type="checkbox" value="SIN_CONSUMO" ${effectiveStatus.includes('SIN_CONSUMO') ? 'checked' : ''}> Sin consumo
                                </label>
                            </div>
                            <small class="text-muted">Por defecto muestra todos. Abre este menú si quieres filtrar.</small>
                        </div>
                        <div class="d-flex justify-content-end gap-2 mt-2">
                            <button class="btn btn-primary" type="button" onclick="showStockForecast(document.getElementById('stock-forecast-period').value, document.getElementById('stock-forecast-history-months').value, getSelectedStockForecastStatuses()); toggleStockForecastFiltersDropdown(false)">
                                Aplicar
                            </button>
                            <button class="btn btn-outline-secondary" type="button" onclick="toggleStockForecastFiltersDropdown(false)">
                                Cerrar
                            </button>
                        </div>
                    </div>
                </div>
                <div class="card-body">
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon bg-primary">
                                <i class="fas fa-boxes"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalProducts ?? 0}</h3>
                                <p>Productos Totales</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon bg-info">
                                <i class="fas fa-history"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.productsWithConsumption ?? 0}</h3>
                                <p>Productos con consumo</p>
                            </div>
                        </div>
                        <div class="stat-card">
                            <div class="stat-icon bg-warning">
                                <i class="fas fa-exclamation-circle"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.criticalProducts ?? 0}</h3>
                                <p>Productos críticos</p>
                            </div>
                        </div>
                    </div>

                    <div class="table-responsive mt-4">
                        <table class="table table-striped">
                            <thead>
                                <tr>
                                    <th>Código</th>
                                    <th>Producto</th>
                                    <th>Origen</th>
                                    <th>Stock</th>
                                    <th>Min Stock</th>
                                    <th>Salidas (${period === 'weekly' ? 'Sem.' : 'Mens.'})</th>
                                    <th>Prom. /${period === 'weekly' ? 'Sem' : 'Mes'}</th>
                                    <th>Días restantes</th>
                                    <th>${period === 'weekly' ? 'Semanas restantes' : 'Meses restantes'}</th>
                                    <th>Estado</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${products.length === 0 ? `
                                    <tr><td colspan="9" class="text-center">No hay datos de consumo para el periodo seleccionado.</td></tr>
                                ` : products.map(product => `
                                    <tr class="${product.status === 'CRITICO' || product.status === 'AGOTADO' ? 'table-danger' : ''}">
                                        <td>${product.code || ''}</td>
                                        <td>${product.name || ''}</td>
                                        <td>${escapeHtml(product.originLabel || 'Otro')}</td>
                                        <td>${formatNumber(product.currentStock || 0)}</td>
                                        <td>${formatNumber(product.minStock || 0)}</td>
                                        <td>${formatNumber(product.totalExitQuantity || 0)}</td>
                                        <td>${formatNumber(product.averagePerPeriod || 0)}</td>
                                        <td>${product.forecastDaysLeftLabel ?? '—'}</td>
                                        <td>${product.forecastPeriodsLeftLabel ?? '—'}</td>
                                        <td>
                                            <span class="status-badge ${getStockForecastBadgeClass(product.status)}">
                                                ${escapeHtml(formatStockForecastStatus(product.status))}
                                            </span>
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;

        mountReportHtml('report-content', html);
        setupStockForecastStatusEvents();
    } catch (error) {
        console.error('Error loading stock forecast:', error);
        showAlert('Error al cargar el pronóstico de stock', 'error');
    } finally {
        hideLoading();
    }
}

// Mostrar reporte de movimientos
async function showMovementsReport() {
    lastMovementsReportContext = null;
    const html = `
        <div class="card movements-report-panel">
            <div class="card-header movements-report-header">
                <h3><i class="fas fa-exchange-alt"></i> Reporte de Movimientos</h3>
            </div>
            <div class="card-body movements-report-body">
                <div class="row movements-report-filters">
                    <div class="col-md-3">
                        <div class="form-group">
                            <label>Fecha Inicio</label>
                            <input type="date" id="movement-report-start" class="form-control" 
                                   value="${new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="form-group">
                            <label>Fecha Fin</label>
                            <input type="date" id="movement-report-end" class="form-control" 
                                   value="${new Date().toISOString().split('T')[0]}">
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="form-group">
                            <label>Tipo de Reporte</label>
                            <select id="movement-report-type" class="form-control">
                                <option value="">Total (Entradas y Salidas)</option>
                                <option value="ENTRADA">Solo Entradas</option>
                                <option value="SALIDA">Solo Salidas</option>
                            </select>
                        </div>
                    </div>
                    <div class="col-md-3">
                        <div class="form-group">
                            <label>Moneda del Reporte</label>
                            <select id="movement-report-currency" class="form-control no-print"></select>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label id="movement-report-client-label">Proveedor (Cliente)</label>
                            <select id="movement-report-client" class="form-control">
                                <option value="">Todos los proveedores</option>
                            </select>
                        </div>
                    </div>
                    <div class="col-md-6">
                        <div class="form-group">
                            <label id="movement-report-cost-center-label">Centro de Costo</label>
                            <select id="movement-report-cost-center" class="form-control">
                                <option value="">Todos los centros de costo</option>
                            </select>
                        </div>
                    </div>
                </div>
                <small id="movement-report-filter-helper" class="text-muted d-block mt-2 movements-report-helper">En reporte total puede usar ambos filtros.</small>
                <div class="d-flex gap-2 movements-report-actions">
                    <button type="button" class="btn btn-primary" id="generate-movements-btn">
                        <i class="fas fa-chart-bar"></i> Generar Reporte
                    </button>
                    <button type="button" class="btn btn-secondary" id="print-movements-btn" onclick="printMovementsReport()" disabled>
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                    <button type="button" class="btn btn-success" id="export-movements-excel-btn" onclick="exportMovementsReportExcel()" disabled>
                        <i class="fas fa-file-excel"></i> Exportar Excel
                    </button>
                    <button type="button" class="btn btn-warning" id="invoice-movements-btn" onclick="generateMovementReportInvoice()" disabled>
                        <i class="fas fa-file-invoice"></i> Generar Factura
                    </button>
                    <button type="button" class="btn btn-success" id="export-invoice-excel-btn" onclick="exportMovementInvoiceExcel()" disabled>
                        <i class="fas fa-file-excel"></i> Factura Excel
                    </button>
                </div>
            </div>
        </div>
        
        <div id="movement-report-result" class="movements-report-result"></div>
    `;
    
    mountReportHtml('report-content', html);
    await Promise.all([
        loadCurrencyOptions('movement-report-currency', 'USD'),
        loadSelectOptionsFromApi('movement-report-client', '/clients?activeOnly=true&limit=1000', 'Todos los proveedores'),
        loadSelectOptionsFromApi('movement-report-cost-center', '/cost-centers?activeOnly=true&limit=1000', 'Todos los centros de costo'),
    ]);

    const btn = document.getElementById('generate-movements-btn');
    if (btn) {
        btn.addEventListener('click', () => {
            try { generateMovementsReport(); } catch (e) { console.error('generateMovementsReport click error', e); }
        });
    }

    const typeEl = document.getElementById('movement-report-type');
    if (typeEl) {
        typeEl.addEventListener('change', applyMovementReportFilterRules);
    }
    applyMovementReportFilterRules();
}

// Generar reporte de movimientos
async function generateMovementsReport() {
    const startDate = document.getElementById('movement-report-start').value;
    const endDate = document.getElementById('movement-report-end').value;
    const currency = document.getElementById('movement-report-currency')?.value || 'USD';
    const type = document.getElementById('movement-report-type')?.value || '';
    const clientIdRaw = document.getElementById('movement-report-client')?.value || '';
    const costCenterIdRaw = document.getElementById('movement-report-cost-center')?.value || '';
    const clientId = type === 'SALIDA' ? '' : clientIdRaw;
    const costCenterId = type === 'ENTRADA' ? '' : costCenterIdRaw;
    
    if (!startDate || !endDate) {
        showAlert('Por favor, seleccione ambas fechas', 'warning');
        return;
    }
    
    try {
        showLoading('movement-report-result');
        const params = new URLSearchParams();
        params.set('startDate', startDate);
        params.set('endDate', endDate);
        params.set('currency', currency);
        if (type) params.set('type', type);
        if (clientId) params.set('clientId', clientId);
        if (costCenterId) params.set('costCenterId', costCenterId);
        const response = await apiRequest(`/movements/movements-report?${params.toString()}`) || {};
        const data = response.data || response || {};
        const summary = data.summary || {};
        const reportTypeLabel = getMovementReportTypeLabel(type);
        const clientText = document.getElementById('movement-report-client')?.selectedOptions?.[0]?.textContent || '';
        const costCenterText = document.getElementById('movement-report-cost-center')?.selectedOptions?.[0]?.textContent || '';
        const clientFilterText = type === 'SALIDA'
            ? 'Proveedor: No aplica.'
            : (clientId ? `Proveedor: ${clientText}.` : 'Todos los proveedores.');
        const costCenterFilterText = type === 'ENTRADA'
            ? 'Centro: No aplica.'
            : (costCenterId ? `Centro: ${costCenterText}.` : 'Todos los centros.');
        
        const html = `
            <div class="card mt-4 movements-report-output">
                <div class="card-header d-flex justify-content-between align-items-center movements-report-output-header">
                    <h4>${reportTypeLabel}: ${formatDate(startDate)} - ${formatDate(endDate)}</h4>
                    <button class="btn btn-primary" onclick="printMovementsReport()">
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                </div>
                <div class="card-body movements-report-output-body">
                    <p class="text-muted mb-2 movements-report-filter-summary">
                        Filtros:
                        ${clientFilterText}
                        ${costCenterFilterText}
                    </p>
                    ${formatExchangeRateHeader(summary.exchangeRateInfo)}
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon bg-success">
                                <i class="fas fa-arrow-down"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalEntries ?? 0}</h3>
                                <p>Entradas</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-warning">
                                <i class="fas fa-arrow-up"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalExits ?? 0}</h3>
                                <p>Salidas</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-primary">
                                <i class="fas fa-dollar-sign"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${formatCurrencyWithEquivalent(summary.totalEntriesValue ?? 0, summary.currency || currency, summary.exchangeRateInfo)}</h3>
                                <p>Valor Entradas</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-danger">
                                <i class="fas fa-dollar-sign"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${formatCurrencyWithEquivalent(summary.totalExitsValue ?? 0, summary.currency || currency, summary.exchangeRateInfo)}</h3>
                                <p>Valor Salidas</p>
                            </div>
                        </div>
                    </div>
                    
                    <h4>Movimientos por Producto</h4>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Entradas (Cantidad)</th>
                                    <th>Entradas (Valor)</th>
                                    <th>Salidas (Cantidad)</th>
                                    <th>Salidas (Valor)</th>
                                    <th>Saldo Final</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.values(summary.products || {}).map(item => `
                                    <tr>
                                        <td>${item.product?.name || ''}</td>
                                        <td>${formatNumber(item.entries || 0)} ${formatUnit(item.product?.unit)}</td>
                                        <td>${formatCurrencyWithEquivalent(item.entriesValue || 0, summary.currency || currency, summary.exchangeRateInfo)}</td>
                                        <td>${formatNumber(item.exits || 0)} ${formatUnit(item.product?.unit)}</td>
                                        <td>${formatCurrencyWithEquivalent(item.exitsValue || 0, summary.currency || currency, summary.exchangeRateInfo)}</td>
                                        <td>${formatNumber(item.product?.stock || 0)} ${formatUnit(item.product?.unit)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <h4>Listado de Movimientos</h4>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Tipo</th>
                                    <th>Documento</th>
                                    <th>Cliente/Centro</th>
                                    <th>Productos</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(data.movements || []).map(movement => `
                                    <tr>
                                        <td>${formatDate(movement.date)}</td>
                                        <td>
                                            <span class="status-badge ${movement.type === 'ENTRADA' ? 'status-active' : 'status-inactive'}">
                                                ${movement.type === 'ENTRADA' ? 'Entrada' : 'Salida'}
                                            </span>
                                        </td>
                                        <td>${movement.documentNumber || 'N/A'}</td>
                                        <td>
                                            ${movement.client ? movement.client.name : ''}
                                            ${movement.costCenter ? movement.costCenter.name : ''}
                                        </td>
                                        <td>
                                            ${(movement.details || []).map(detail => 
                                                `${detail.product?.name || ''} (${formatNumber(detail.quantity || 0)} ${formatUnit(detail.product?.unit)})`
                                            ).join('<br>')}
                                        </td>
                                        <td>
                                            ${formatCurrencyWithEquivalent((movement.reportTotal !== undefined ? movement.reportTotal : (movement.details || []).reduce((sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0), 0)), summary.currency || currency, summary.exchangeRateInfo)}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        mountReportHtml('movement-report-result', html);
        lastMovementsReportContext = {
            generatedAt: new Date().toISOString(),
            filters: {
                startDate,
                endDate,
                type,
                currency,
                clientId,
                costCenterId,
                clientText,
                costCenterText,
            },
            summary,
            movements: data.movements || [],
        };

        // Habilitar boton de impresion en la seccion de control
        const printBtn = document.getElementById('print-movements-btn');
        if (printBtn) printBtn.disabled = false;
        const exportBtn = document.getElementById('export-movements-excel-btn');
        if (exportBtn) exportBtn.disabled = !(Array.isArray(data.movements) && data.movements.length > 0);
        const invoiceBtn = document.getElementById('invoice-movements-btn');
        if (invoiceBtn) invoiceBtn.disabled = !(Array.isArray(data.movements) && data.movements.length > 0);
        const exportInvoiceBtn = document.getElementById('export-invoice-excel-btn');
        if (exportInvoiceBtn) exportInvoiceBtn.disabled = !(Array.isArray(data.movements) && data.movements.length > 0);
        
    } catch (error) {
        console.error('Error generating movements report:', error);
        lastMovementsReportContext = null;
        const target = document.getElementById('movement-report-result');
        if (target) {
            target.innerHTML = `<div class="alert alert-error"><i class="fas fa-exclamation-circle"></i><span>Error al generar el reporte de movimientos</span></div>`;
        }
        const invoiceBtn = document.getElementById('invoice-movements-btn');
        if (invoiceBtn) invoiceBtn.disabled = true;
        const exportBtn = document.getElementById('export-movements-excel-btn');
        if (exportBtn) exportBtn.disabled = true;
        const exportInvoiceBtn = document.getElementById('export-invoice-excel-btn');
        if (exportInvoiceBtn) exportInvoiceBtn.disabled = true;
        showAlert('Error al generar el reporte de movimientos', 'error');
    } finally {
        hideLoading();
    }
}

async function generateMovementReportInvoice() {
    if (!lastMovementsReportContext || !Array.isArray(lastMovementsReportContext.movements) || lastMovementsReportContext.movements.length === 0) {
        showAlert('Genere primero un reporte de movimientos con datos', 'warning');
        return;
    }

    const ctx = lastMovementsReportContext;
    const invoiceNumber = nextInvoiceNumber();
    const company = await getCompanyInfoSafe();
    const logoUrl = await getCompanyLogoUrl();
    const reportTypeLabel = getMovementReportTypeLabel(ctx.filters?.type || '');
    const issueDate = new Date();
    const summary = ctx.summary || {};
    const currency = summary.currency || ctx.filters?.currency || 'USD';

    const totalAmount = (parseNumberSafe(summary.totalEntriesValue) || 0) + (parseNumberSafe(summary.totalExitsValue) || 0);

    const headerFilters = [
        `Tipo: ${reportTypeLabel}`,
        `Periodo: ${formatDate(ctx.filters?.startDate)} - ${formatDate(ctx.filters?.endDate)}`,
        ctx.filters?.clientId ? `Proveedor: ${ctx.filters.clientText}` : 'Proveedor: Todos',
        ctx.filters?.costCenterId ? `Centro: ${ctx.filters.costCenterText}` : 'Centro: Todos',
    ].join(' | ');

    const rowsHtml = ctx.movements.map((movement, index) => {
        const movementTotal = (movement.reportTotal !== undefined
            ? movement.reportTotal
            : (movement.details || []).reduce((sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0), 0));
        const partyName = movement.type === 'ENTRADA'
            ? (movement.client?.name || 'N/A')
            : (movement.costCenter?.name || 'N/A');
        return `
            <tr>
                <td>${index + 1}</td>
                <td>${formatDate(movement.date)}</td>
                <td>${movement.documentNumber || '-'}</td>
                <td>${movement.type === 'ENTRADA' ? 'Entrada' : 'Salida'}</td>
                <td>${partyName}</td>
                <td style="text-align:right;">${formatCurrencyWithEquivalent(movementTotal, currency, summary.exchangeRateInfo)}</td>
            </tr>
        `;
    }).join('');

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        showAlert('El navegador bloqueó la ventana de factura. Permita pop-ups para este sitio.', 'warning');
        return;
    }
    printWindow.document.write(`
        <html>
            <head>
                <title>Factura ${invoiceNumber}</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 16mm; color: #222; }
                    .header { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 18px; }
                    .left h1 { margin: 0 0 6px; font-size: 1.35rem; }
                    .left p { margin: 2px 0; font-size: 0.92rem; }
                    .right { text-align: right; }
                    .right .num { font-size: 1.1rem; font-weight: 700; }
                    .logo { width: 34mm; height: 34mm; object-fit: contain; margin-bottom: 8px; }
                    .meta { border: 1px solid #d9d9d9; background: #f9fbfd; padding: 10px; border-radius: 6px; margin-bottom: 12px; font-size: 0.9rem; }
                    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
                    th, td { border: 1px solid #dadada; padding: 8px; font-size: 0.88rem; vertical-align: top; }
                    th { background: #f2f5f9; text-align: left; }
                    .totals { margin-top: 12px; display: flex; justify-content: flex-end; }
                    .totals-box { min-width: 260px; border: 1px solid #d9d9d9; border-radius: 6px; padding: 10px; }
                    .totals-line { display: flex; justify-content: space-between; gap: 10px; margin: 4px 0; }
                    .totals-line strong { font-size: 1rem; }
                </style>
            </head>
            <body>
                <div class="header">
                    <div class="left">
                        ${logoUrl ? `<img class="logo" src="${logoUrl}" alt="Logo">` : ''}
                        <h1>${company?.name || 'Oasis Guest House'}</h1>
                        ${company?.address ? `<p>${company.address}</p>` : ''}
                        ${company?.phone ? `<p>Tel: ${company.phone}</p>` : ''}
                        ${company?.email ? `<p>Email: ${company.email}</p>` : ''}
                    </div>
                    <div class="right">
                        <div class="num">FACTURA: ${invoiceNumber}</div>
                        <p>Fecha: ${formatDate(issueDate)}</p>
                    </div>
                </div>

                <div class="meta">
                    <div><strong>Origen:</strong> Reporte de movimientos generado en el sistema.</div>
                    <div><strong>Filtros:</strong> ${headerFilters}</div>
                    ${formatExchangeRateHeader(summary.exchangeRateInfo)}
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th>Fecha</th>
                            <th>Documento</th>
                            <th>Tipo</th>
                            <th>Proveedor/Centro</th>
                            <th style="text-align:right;">Importe</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rowsHtml}
                    </tbody>
                </table>

                <div class="totals">
                    <div class="totals-box">
                        <div class="totals-line"><span>Total Entradas</span><span>${formatCurrencyWithEquivalent(summary.totalEntriesValue || 0, currency, summary.exchangeRateInfo)}</span></div>
                        <div class="totals-line"><span>Total Salidas</span><span>${formatCurrencyWithEquivalent(summary.totalExitsValue || 0, currency, summary.exchangeRateInfo)}</span></div>
                        <div class="totals-line"><strong>Total Factura</strong><strong>${formatCurrencyWithEquivalent(totalAmount, currency, summary.exchangeRateInfo)}</strong></div>
                    </div>
                </div>
            </body>
        </html>
    `);

    printWindow.document.close();
    printWindow.focus();

    setTimeout(() => {
        printWindow.print();
        printWindow.close();
    }, 300);
}

function exportMovementsReportExcel() {
    if (!lastMovementsReportContext || !Array.isArray(lastMovementsReportContext.movements) || lastMovementsReportContext.movements.length === 0) {
        showAlert('Genere primero un reporte de movimientos con datos', 'warning');
        return;
    }

    const ctx = lastMovementsReportContext;
    const params = new URLSearchParams();
    params.set('startDate', ctx.filters?.startDate || '');
    params.set('endDate', ctx.filters?.endDate || '');
    params.set('currency', ctx.filters?.currency || 'USD');
    if (ctx.filters?.type) params.set('type', ctx.filters.type);
    if (ctx.filters?.clientId) params.set('clientId', String(ctx.filters.clientId));
    if (ctx.filters?.costCenterId) params.set('costCenterId', String(ctx.filters.costCenterId));

    downloadExcelFromApi(`/reports/movements/export?${params.toString()}`, 'reporte_movimientos.xlsx')
        .catch((error) => {
            console.error('Error exportando reporte de movimientos:', error);
            showAlert(error.message || 'Error al exportar reporte a Excel', 'error');
        });
}

function exportMovementInvoiceExcel() {
    if (!lastMovementsReportContext || !Array.isArray(lastMovementsReportContext.movements) || lastMovementsReportContext.movements.length === 0) {
        showAlert('Genere primero un reporte de movimientos con datos', 'warning');
        return;
    }

    const ctx = lastMovementsReportContext;
    const params = new URLSearchParams();
    params.set('startDate', ctx.filters?.startDate || '');
    params.set('endDate', ctx.filters?.endDate || '');
    params.set('currency', ctx.filters?.currency || 'USD');
    if (ctx.filters?.type) params.set('type', ctx.filters.type);
    if (ctx.filters?.clientId) params.set('clientId', String(ctx.filters.clientId));
    if (ctx.filters?.costCenterId) params.set('costCenterId', String(ctx.filters.costCenterId));
    params.set('invoiceNumber', nextInvoiceNumber());

    downloadExcelFromApi(`/reports/movements/invoice-export?${params.toString()}`, 'factura_movimientos.xlsx')
        .catch((error) => {
            console.error('Error exportando factura en Excel:', error);
            showAlert(error.message || 'Error al exportar factura a Excel', 'error');
        });
}

// Mostrar reporte por cliente
async function showClientReport() {
    try {
        // Cargar clientes para selección
        const response = await apiRequest('/clients?activeOnly=true&limit=1000') || {};
        
        const clientsOptions = (Array.isArray(response.data) ? response.data : []).map(client => 
            `<option value="${client.id}">${client.code} - ${client.name}</option>`
        ).join('');
        
        const html = `
            <div class="card">
                <div class="card-header">
                    <h3><i class="fas fa-users"></i> Reporte por Cliente</h3>
                </div>
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6">
                            <div class="form-group">
                                <label>Cliente</label>
                                <select id="client-report-client" class="form-control">
                                    <option value="">Seleccionar cliente</option>
                                    ${clientsOptions}
                                </select>
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="form-group">
                                <label>Fecha Inicio</label>
                                <input type="date" id="client-report-start" class="form-control">
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="form-group">
                                <label>Fecha Fin</label>
                                <input type="date" id="client-report-end" class="form-control">
                            </div>
                        </div>
                        <div class="col-md-3">
                            <div class="form-group">
                                <label>Moneda del Reporte</label>
                                <select id="client-report-currency" class="form-control no-print"></select>
                            </div>
                        </div>
                    </div>
                    <div class="d-flex gap-2">
                        <button class="btn btn-primary" id="generate-client-btn" onclick="generateClientReport()">
                            <i class="fas fa-chart-bar"></i> Generar Reporte
                        </button>
                        <button class="btn btn-secondary" id="print-client-btn" onclick="printClientReport()" disabled>
                            <i class="fas fa-print"></i> Imprimir
                        </button>
                    </div>
                </div>
            </div>
            
            <div id="client-report-result"></div>
        `;
        
        mountReportHtml('report-content', html);
        await loadCurrencyOptions('client-report-currency', 'USD');
        
    } catch (error) {
        console.error('Error setting up client report:', error);
        showAlert('Error al cargar los clientes', 'error');
    }
}

// Generar reporte por cliente
async function generateClientReport() {
    const clientId = document.getElementById('client-report-client').value;
    const startDate = document.getElementById('client-report-start').value;
    const endDate = document.getElementById('client-report-end').value;
    const currency = document.getElementById('client-report-currency')?.value || 'USD';
    
    if (!clientId) {
        showAlert('Por favor, seleccione un cliente', 'warning');
        return;
    }
    
    try {
        showLoading('client-report-result');
        
        let url = `/reports/client/${clientId}`;
        if (startDate) url += `?startDate=${startDate}`;
        if (endDate) url += `${startDate ? '&' : '?'}endDate=${endDate}`;
        
        if (currency) url += `${url.includes('?') ? '&' : '?'}currency=${encodeURIComponent(currency)}`;
        const response = await apiRequest(url) || {};
        const data = response.data || response || {};
        // Normalizar detalles numéricos
        (data.movements || []).forEach(m => {
            if (m.details && Array.isArray(m.details)) {
                m.details = m.details.map(d => ({
                    ...d,
                    quantity: parseNumberSafe(d.quantity),
                    unitCost: parseNumberSafe(d.unitCost),
                    totalCost: parseNumberSafe(d.totalCost)
                }));
            }
        });
        const summary = data.summary || {};
        const movements = data.movements || [];
        
        const html = `
            <div class="card mt-4">
                <div class="card-header d-flex justify-content-between align-items-center">
                    <div>
                        <h4>Reporte del Cliente: ${movements[0]?.client?.name || 'Cliente'}</h4>
                        ${startDate || endDate ? `<p>Período: ${startDate || 'Inicio'} - ${endDate || 'Fin'}</p>` : ''}
                    </div>
                    <button class="btn btn-primary" onclick="printClientReport()">
                        <i class="fas fa-print"></i> Imprimir
                    </button>
                </div>
                <div class="card-body">
                    ${formatExchangeRateHeader(summary.exchangeRateInfo)}
                    <div class="stats-grid">
                        <div class="stat-card">
                            <div class="stat-icon bg-primary">
                                <i class="fas fa-exchange-alt"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalMovements ?? 0}</h3>
                                <p>Total Movimientos</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-success">
                                <i class="fas fa-arrow-down"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalEntries ?? 0}</h3>
                                <p>Entradas</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-warning">
                                <i class="fas fa-arrow-up"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${summary.totalExits ?? 0}</h3>
                                <p>Salidas</p>
                            </div>
                        </div>
                        
                        <div class="stat-card">
                            <div class="stat-icon bg-danger">
                                <i class="fas fa-dollar-sign"></i>
                            </div>
                            <div class="stat-info">
                                <h3>${formatCurrencyWithEquivalent(summary.totalValue ?? 0, summary.currency || currency, summary.exchangeRateInfo)}</h3>
                                <p>Valor Total</p>
                            </div>
                        </div>
                    </div>
                    
                    <h4>Resumen por Producto</h4>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Producto</th>
                                    <th>Cantidad Total</th>
                                    <th>Valor Total</th>
                                    <th>Promedio por Movimiento</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${Object.values(summary.products || {}).map(item => `
                                    <tr>
                                        <td>${item.product?.name || ''}</td>
                                        <td>${formatNumber(item.totalQuantity || 0)} ${formatUnit(item.product?.unit)}</td>
                                        <td>${formatCurrencyWithEquivalent(item.totalValue || 0, summary.currency || currency, summary.exchangeRateInfo)}</td>
                                        <td>${formatCurrencyWithEquivalent((item.totalValue || 0) / (summary.totalMovements || 1), summary.currency || currency, summary.exchangeRateInfo)}</td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                    
                    <h4>Listado de Movimientos</h4>
                    <div class="table-responsive">
                        <table class="table">
                            <thead>
                                <tr>
                                    <th>Fecha</th>
                                    <th>Tipo</th>
                                    <th>Documento</th>
                                    <th>Descripción</th>
                                    <th>Productos</th>
                                    <th>Total</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${(movements || []).map(movement => `
                                    <tr>
                                        <td>${formatDate(movement.date)}</td>
                                        <td>
                                            <span class="status-badge ${movement.type === 'ENTRADA' ? 'status-active' : 'status-inactive'}">
                                                ${movement.type === 'ENTRADA' ? 'Entrada' : 'Salida'}
                                            </span>
                                        </td>
                                        <td>${movement.documentNumber || 'N/A'}</td>
                                        <td>${movement.description || ''}</td>
                                        <td>
                                            ${(movement.details || []).map(detail => 
                                                `${detail.product?.name || ''} (${formatNumber(detail.quantity || 0)} ${formatUnit(detail.product?.unit)})`
                                            ).join('<br>')}
                                        </td>
                                        <td>
                                            ${formatCurrencyWithEquivalent((movement.reportTotal !== undefined ? movement.reportTotal : (movement.details || []).reduce((sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0), 0)), summary.currency || currency, summary.exchangeRateInfo)}
                                        </td>
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        `;
        
        mountReportHtml('client-report-result', html);

        // Habilitar botón de impresión en la sección de control
        const printBtn = document.getElementById('print-client-btn');
        if (printBtn) printBtn.disabled = false;
        
    } catch (error) {
        console.error('Error generating client report:', error);
        showAlert('Error al generar el reporte del cliente', 'error');
    } finally {
        hideLoading();
    }
}

// Imprimir reporte de stock
async function printStockReport() {
    const content = document.getElementById('report-content').innerHTML;
    const logoUrl = await getCompanyLogoUrl();
    
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>Reporte de Inventario</title>
                <link rel="stylesheet" href="css/print.css">
                <style>
                    body { font-family: Arial, sans-serif; margin: 20mm; }
                    .report-header { text-align: center; margin-bottom: 30px; }
                    .report-logo { width: 3cm; height: 3cm; object-fit: contain; display: block; margin: 0 auto 10mm; }
                    .stats-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin: 20px 0; }
                    .stat-card { border: 1px solid #000; padding: 15px; text-align: center; }
                    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    .table th, .table td { border: 1px solid #000; padding: 8px; }
                    .table-danger { background-color: #f8d7da !important; }
                    .no-print { display: none; }
                </style>
            </head>
            <body>
                <div class="report-header">
                    ${logoUrl ? `<img class="report-logo" src="${logoUrl}" alt="Logo">` : ''}
                    <h1>Reporte de Inventario</h1>
                    <p>Generado: ${new Date().toLocaleDateString()}</p>
                </div>
                ${content}
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

async function printReport(elementId, title) {
    const content = document.getElementById(elementId)?.innerHTML;
    if (!content) {
        showAlert('No hay contenido para imprimir', 'warning');
        return;
    }

    const logoUrl = await getCompanyLogoUrl();
    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <html>
            <head>
                <title>${title}</title>
                <link rel="stylesheet" href="css/print.css">
                <style>
                    body { font-family: Arial, sans-serif; margin: 20mm; }
                    .report-header { text-align: center; margin-bottom: 30px; }
                    .report-logo { width: 3cm; height: 3cm; object-fit: contain; display: block; margin: 0 auto 10mm; }
                    .table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                    .table th, .table td { border: 1px solid #000; padding: 8px; }
                    .table-danger { background-color: #f8d7da !important; }
                </style>
            </head>
            <body>
                <div class="report-header">
                    ${logoUrl ? `<img class="report-logo" src="${logoUrl}" alt="Logo">` : ''}
                    <h1>${title}</h1>
                    <p>Generado: ${new Date().toLocaleDateString()}</p>
                </div>
                ${content}
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

async function printStockForecast() {
    printReport('report-content', 'Pronóstico de Stock');
}

function printMovementsReport() {
    printReport('movement-report-result', 'Reporte de Movimientos');
}

function printClientReport() {
    printReport('client-report-result', 'Reporte por Cliente');
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    // Inicialización específica de reportes si es necesario
});
