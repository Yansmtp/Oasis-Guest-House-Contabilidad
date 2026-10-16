let movements = [];
let currentMovementPage = 1;
let totalMovementPages = 1;
let movementDetails = [];
let movementProducts = [];
let movementCurrencies = [];
let movementCurrencyCode = 'USD';
let movementCurrencyRate = 1;
let movementCupRate = 0.0083; // USD por 1 CUP
let movementRatesLoadedAt = 0;
let movementRateInputBound = false;
let pendingMovementOverrideData = null;

function generateProductCodeFallback() {
    const yy = String(new Date().getFullYear()).slice(-2);
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `PRD${yy}${rand}`;
}

async function getNextProductCode() {
    try {
        const response = await apiRequest('/products/next-code');
        return response?.code || generateProductCodeFallback();
    } catch (error) {
        console.warn('No se pudo obtener el siguiente codigo de producto:', error);
        return generateProductCodeFallback();
    }
}

function generateMovementDocumentCode(type, dateValue) {
    const date = dateValue ? new Date(dateValue) : new Date();
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    const prefix = type === 'ENTRADA' ? 'ENT' : 'SAL';
    return `${prefix}-${y}${m}${d}-${hh}${mm}${ss}`;
}

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

function buildDualCurrencyHtml(amount, currencyCode, rateAtTransaction) {
    const amountNum = parseNumberSafe(amount);
    const code = (currencyCode || 'USD').toUpperCase();
    const rate = parseNumberSafe(rateAtTransaction) > 0 ? parseNumberSafe(rateAtTransaction) : 1;

    const amountUsd = code === 'USD' ? amountNum : amountNum * rate;
    const cupRate = parseNumberSafe(movementCupRate) > 0 ? parseNumberSafe(movementCupRate) : 0.0083;
    const amountCup = cupRate > 0 ? amountUsd / cupRate : 0;

    const usdText = formatCurrency(amountUsd, 'USD');
    const cupText = formatCurrency(amountCup, 'CUP');
    const originalText = code !== 'USD' && code !== 'CUP'
        ? `<small>${formatCurrency(amountNum, code)}</small>`
        : '';

    return `<div class="cell-currency-stack">${originalText}<small>USD: ${usdText}</small><small>CUP: ${cupText}</small></div>`;
}

function setMovementRateInputValue(rateUsdPerUnit) {
    const rateInput = document.getElementById('movement-currency-rate');
    if (!rateInput) return;
    const displayValue = rateUsdPerUnit > 0 ? (1 / rateUsdPerUnit) : '';
    rateInput.value = displayValue ? parseFloat(displayValue).toFixed(6) : '';
}

function bindMovementRateInput() {
    const rateInput = document.getElementById('movement-currency-rate');
    if (!rateInput || movementRateInputBound) return;
    rateInput.addEventListener('input', () => {
        const entered = parseNumberSafe(rateInput.value);
        if (entered > 0) {
            movementCurrencyRate = 1 / entered;
            renderMovementDetails();
        }
    });
    movementRateInputBound = true;
}

function resetMovementRateToDefault() {
    const select = document.getElementById('movement-currency');
    const chosen = movementCurrencies.find(c => c.code === (select?.value || movementCurrencyCode));
    if (!chosen) return;
    movementCurrencyRate = chosen.rate || 1;
    setMovementRateInputValue(movementCurrencyRate);
    renderMovementDetails();
}

async function refreshMovementCurrencyRates(force = false) {
    const now = Date.now();
    if (!force && movementRatesLoadedAt && (now - movementRatesLoadedAt) < 300000) return;

    try {
        const response = await apiRequest('/currencies');
        const list = response?.data || [];
        const cup = list.find(c => (c.code || '').toUpperCase() === 'CUP');
        if (cup?.rate && parseNumberSafe(cup.rate) > 0) {
            movementCupRate = parseNumberSafe(cup.rate);
        }
        movementRatesLoadedAt = now;
    } catch (error) {
        console.warn('No se pudo refrescar tasa CUP para movimientos:', error);
    }
}

// Cargar movimientos
async function loadMovements(page = 1, filters = {}) {
    try {
        showLoading('movements-table');
        await refreshMovementCurrencyRates();
        
        let url = `/movements?page=${page}&limit=10`;
        
        if (filters.type) url += `&type=${filters.type}`;
        if (filters.startDate) url += `&startDate=${filters.startDate}`;
        if (filters.endDate) url += `&endDate=${filters.endDate}`;
        if (filters.clientId) url += `&clientId=${filters.clientId}`;
        if (filters.costCenterId) url += `&costCenterId=${filters.costCenterId}`;
        
        const response = await apiRequest(url);
        
        movements = (response.data || []).map(m => {
            if (m.details && Array.isArray(m.details)) {
                m.details = m.details.map(d => ({
                    ...d,
                    quantity: parseNumberSafe(d.quantity),
                    unitCost: parseNumberSafe(d.unitCost),
                    totalCost: parseNumberSafe(d.totalCost)
                }));
            }
            return m;
        });
        currentMovementPage = response.meta.page;
        totalMovementPages = response.meta.totalPages;
        
        renderMovementsTable();
        createPagination('movements-pagination', currentMovementPage, totalMovementPages, 
            (newPage) => loadMovements(newPage, filters));
        
    } catch (error) {
        console.error('Error loading movements:', error);
    } finally {
        hideLoading();
    }
}

// Renderizar tabla de movimientos
function renderMovementsTable() {
    const tbody = document.getElementById('movements-table').querySelector('tbody');
    tbody.innerHTML = '';
    
    if (movements.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="8" class="text-center">
                No se encontraron movimientos
            </td>
        `;
        tbody.appendChild(row);
        return;
    }
    
    const compact = typeof isCompactListView === 'function' && isCompactListView();

    movements.forEach(movement => {
        const row = document.createElement('tr');
        const canReverse = isAdmin() && movement.status !== 'REVERSED';

        if (compact) {
            row.className = 'table-compact-row';
            row.innerHTML = `<td colspan="8" class="table-compact-cell">${buildMovementListItemHtml(movement, { canReverse })}</td>`;
            tbody.appendChild(row);
            return;
        }

        let entity = '';
        if (movement.client) {
            entity = `<strong>Cliente:</strong> ${escapeHtml(movement.client.name)}`;
        } else if (movement.costCenter) {
            entity = `<strong>Centro:</strong> ${escapeHtml(movement.costCenter.name)}`;
        }

        const total = (movement.details || []).reduce((sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0), 0);
        const currency = movement.currencyCode || 'USD';
        const rateAtTransaction = parseNumberSafe(movement.rateAtTransaction) || 1;
        const productCount = movement.details.length;

        row.innerHTML = `
            <td class="cell-compact">${formatDate(movement.date)}</td>
            <td class="cell-compact">
                <span class="status-badge ${movement.status === 'REVERSED' ? 'status-inactive' : (movement.type === 'ENTRADA' ? 'status-active' : 'status-inactive')}">
                    ${movement.status === 'REVERSED' ? 'Anulado · ' : ''}${movement.type === 'ENTRADA' ? 'Entrada' : 'Salida'}
                </span>
            </td>
            <td class="cell-text">${escapeHtml(movement.documentNumber || 'N/A')}</td>
            <td class="cell-text">${entity}</td>
            <td class="cell-text">${escapeHtml(movement.description || '')}</td>
            <td class="cell-compact">${productCount} producto(s)</td>
            <td class="cell-currency">${buildDualCurrencyHtml(total, currency, rateAtTransaction)}</td>
            <td class="actions">
                <button class="btn btn-sm btn-outline" onclick="viewMovement(${movement.id})" title="Ver detalle">
                    <i class="fas fa-eye"></i>
                </button>
                ${canDelete ? `
                <button class="btn btn-sm btn-danger" onclick="reverseMovement(${movement.id})" title="Anular">
                    <i class="fas fa-rotate-left"></i>
                </button>` : ''}
                <button class="btn btn-sm btn-outline" onclick="printVoucher(${movement.id})" title="Imprimir">
                    <i class="fas fa-print"></i>
                </button>
            </td>
        `;

        tbody.appendChild(row);
    });
}

// Filtrar movimientos
function filterMovements() {
    const filters = {
        type: document.getElementById('movement-type-filter').value || undefined,
        startDate: document.getElementById('movement-start-date').value || undefined,
        endDate: document.getElementById('movement-end-date').value || undefined
    };
    
    loadMovements(1, filters);
}

// Limpiar filtros
function clearMovementFilters() {
    document.getElementById('movement-type-filter').value = '';
    document.getElementById('movement-start-date').value = '';
    document.getElementById('movement-end-date').value = '';
    loadMovements(1);
}

// Mostrar modal para movimiento
async function showMovementModal(type) {
    resetForm('movement-form');
    movementDetails = [];
    
    document.getElementById('movement-modal-title').textContent = 
        type === 'ENTRADA' ? 'Nueva Entrada' : 'Nueva Salida';
    
    document.getElementById('movement-type').value = type;
    document.getElementById('movement-date').value = new Date().toISOString().slice(0, 16);
    document.getElementById('movement-document').value = generateMovementDocumentCode(
        type,
        document.getElementById('movement-date').value
    );
    const movementDateEl = document.getElementById('movement-date');
    const movementDocEl = document.getElementById('movement-document');
    if (movementDateEl && movementDocEl) {
        movementDateEl.onchange = () => {
            if (!movementDocEl.value || /^ENT-|^SAL-/.test(movementDocEl.value)) {
                movementDocEl.value = generateMovementDocumentCode(type, movementDateEl.value);
            }
        };
    }
    await refreshMovementCurrencyRates();
    
    // Configurar campos según tipo
    if (type === 'ENTRADA') {
        document.getElementById('movement-client-section').style.display = 'block';
        document.getElementById('movement-cost-center-section').style.display = 'none';
        document.getElementById('movement-client-label').textContent = 'Proveedor *';
        document.getElementById('movement-client').setAttribute('required', 'required');
        document.getElementById('movement-cost-center').removeAttribute('required');
        document.getElementById('movement-currency-row').style.display = 'flex';
        await loadCurrenciesForMovement();
        await loadClientsForMovement('movement-client');
    } else {
        document.getElementById('movement-client-section').style.display = 'none';
        document.getElementById('movement-cost-center-section').style.display = 'block';
        document.getElementById('movement-cost-center').setAttribute('required', 'required');
        document.getElementById('movement-client').removeAttribute('required');
        document.getElementById('movement-currency-row').style.display = 'none';
        movementCurrencyCode = 'USD';
        movementCurrencyRate = 1;
        await loadCostCentersForMovement('movement-cost-center');
    }

    await prepareCounterpartForMovement(type);

    renderMovementDetails();
    showModal('movement-modal');
    const scrollEl = getMovementFormScrollEl();
    if (scrollEl) scrollEl.scrollTop = 0;
}

async function loadCurrenciesForMovement() {
    try {
        const response = await apiRequest('/currencies');
        movementCurrencies = response?.data || [];
        const cup = movementCurrencies.find(c => (c.code || '').toUpperCase() === 'CUP');
        if (cup?.rate && parseNumberSafe(cup.rate) > 0) {
            movementCupRate = parseNumberSafe(cup.rate);
        }
        const select = document.getElementById('movement-currency');
        const rateInput = document.getElementById('movement-currency-rate');

        if (!select) return;
        select.innerHTML = '';
        movementCurrencies.forEach(c => {
            const option = document.createElement('option');
            option.value = c.code;
            option.textContent = `${c.code} - ${c.name}`;
            if (c.isDefault) option.selected = true;
            select.appendChild(option);
        });

        const selected = movementCurrencies.find(c => c.code === select.value) || movementCurrencies[0];
        if (selected) {
            movementCurrencyCode = selected.code;
            movementCurrencyRate = selected.rate || 1;
            setMovementRateInputValue(movementCurrencyRate);
        }

        select.onchange = () => {
            const chosen = movementCurrencies.find(c => c.code === select.value);
            if (!chosen) return;
            movementCurrencyCode = chosen.code;
            movementCurrencyRate = chosen.rate || 1;
            setMovementRateInputValue(movementCurrencyRate);
            renderMovementDetails();
        };
        bindMovementRateInput();
    } catch (error) {
        console.error('Error loading currencies for movement:', error);
    }
}

// Cargar clientes para movimiento
async function loadClientsForMovement(selectId) {
    try {
        const response = await apiRequest('/clients?activeOnly=true&limit=1000');
        const select = document.getElementById(selectId);
        select.innerHTML = '<option value="">Seleccionar proveedor</option>';
        
        response.data.forEach(client => {
            const option = document.createElement('option');
            option.value = client.id;
            option.textContent = `${client.code} - ${client.name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading clients:', error);
    }
}

// Cargar centros de costo para movimiento
async function loadCostCentersForMovement(selectId) {
    try {
        const response = await apiRequest('/cost-centers?activeOnly=true&limit=1000');
        const select = document.getElementById(selectId);
        select.innerHTML = '<option value="">Seleccionar centro de costo</option>';
        
        response.data.forEach(center => {
            const option = document.createElement('option');
            option.value = center.id;
            option.textContent = `${center.code} - ${center.name}`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading cost centers:', error);
    }
}

// Agregar detalle al movimiento
async function addMovementDetail() {
    // Primero cargar productos para selección
    await loadProductsForSelection();
    showModal('product-selection-modal');
}

async function showQuickProductModal() {
    const form = document.getElementById('quick-product-form');
    if (form) form.reset();

    if (typeof setupUnitSelectBehavior === 'function') {
        setupUnitSelectBehavior('quick-product-unit', 'UNIDAD');
    }
    const unitEl = document.getElementById('quick-product-unit');
    const minStockEl = document.getElementById('quick-product-min-stock');
    if (unitEl) unitEl.value = 'UNIDAD';
    if (minStockEl) minStockEl.value = '0';
    const codeEl = document.getElementById('quick-product-code');
    if (codeEl) codeEl.value = await getNextProductCode();

    if (typeof showModal === 'function') {
        showModal('quick-product-modal');
    } else {
        const modal = document.getElementById('quick-product-modal');
        const overlay = document.getElementById('modal-overlay');
        if (overlay) overlay.style.display = 'block';
        if (modal) modal.style.display = 'flex';
    }
}

function closeQuickProductModal() {
    if (typeof closeModal === 'function') {
        closeModal('quick-product-modal');
    } else {
        const modal = document.getElementById('quick-product-modal');
        if (modal) modal.style.display = 'none';
    }
}

async function saveQuickProductFromMovement() {
    const code = (document.getElementById('quick-product-code')?.value || '').trim();
    const name = (document.getElementById('quick-product-name')?.value || '').trim();
    const description = (document.getElementById('quick-product-description')?.value || '').trim();
    const unit = typeof getUnitValueFromSelect === 'function'
        ? getUnitValueFromSelect('quick-product-unit')
        : (document.getElementById('quick-product-unit')?.value || 'UNIDAD');
    const minStock = parseFloat(document.getElementById('quick-product-min-stock')?.value || '0');
    const maxStockRaw = document.getElementById('quick-product-max-stock')?.value;

    if (!code || !name) {
        showAlert('Código y nombre son obligatorios', 'warning');
        return;
    }

    const payload = {
        code,
        name,
        description: description || undefined,
        unit,
        minStock: Number.isFinite(minStock) ? minStock : 0,
        isActive: true
    };

    if (maxStockRaw !== undefined && String(maxStockRaw).trim() !== '') {
        const maxStock = parseFloat(maxStockRaw);
        if (Number.isFinite(maxStock)) payload.maxStock = maxStock;
    }

    try {
        const created = await apiRequest('/products', {
            method: 'POST',
            body: JSON.stringify(payload)
        });

        movementProducts.push(created);

        const movementType = document.getElementById('movement-type').value;
        const defaultUnitCost = movementType === 'ENTRADA' && movementCurrencyCode !== 'USD'
            ? (parseNumberSafe(created.unitCost || 0) / (movementCurrencyRate || 1))
            : parseNumberSafe(created.unitCost || 0);

        movementDetails.push({
            productId: created.id,
            product: created,
            quantity: 1,
            unitCost: defaultUnitCost,
            total: defaultUnitCost
        });

        renderMovementDetails({ focusIndex: movementDetails.length - 1 });
        closeQuickProductModal();
        showAlert('Producto creado y agregado al movimiento', 'success');

        try { await loadProductsForSelection(); } catch (e) { /* noop */ }
    } catch (error) {
        showAlert(error.message || 'Error al crear producto', 'error');
    }
}

// Cargar productos para selección
async function loadProductsForSelection() {
    try {
        const response = await apiRequest('/products?activeOnly=true&limit=1000');
        movementProducts = response.data;
        
        const tbody = document.getElementById('products-selection-table').querySelector('tbody');
        tbody.innerHTML = '';
        
        const compact = typeof isCompactListView === 'function' && isCompactListView();

        movementProducts.forEach(product => {
            const row = document.createElement('tr');
            if (compact) {
                row.className = 'table-compact-row';
                row.innerHTML = `
                    <td colspan="5" class="table-compact-cell">
                        <div class="list-item-card">
                            <div class="list-item-body">
                                <div class="list-item-top">
                                    <span class="list-item-code">${escapeHtml(product.code)}</span>
                                </div>
                                <div class="list-item-title">${escapeHtml(product.name)}</div>
                                <div class="list-item-meta">
                                    <span><strong>Stock:</strong> ${formatNumber(product.stock)} ${escapeHtml(formatUnit(product.unit))}</span>
                                    <span><strong>Costo:</strong> ${formatCurrency(product.unitCost)}</span>
                                </div>
                            </div>
                            <div class="list-item-actions">
                                <button type="button" class="btn btn-sm btn-primary" onclick="selectProduct(${product.id})" title="Seleccionar" aria-label="Seleccionar">
                                    <i class="fas fa-plus"></i>
                                </button>
                            </div>
                        </div>
                    </td>
                `;
            } else {
                row.innerHTML = `
                    <td>${product.code}</td>
                    <td>${product.name}</td>
                    <td>${formatNumber(product.stock)} ${formatUnit(product.unit)}</td>
                    <td>${formatCurrency(product.unitCost)}</td>
                    <td>
                        <button class="btn btn-sm btn-primary" onclick="selectProduct(${product.id})">
                            Seleccionar
                        </button>
                    </td>
                `;
            }
            tbody.appendChild(row);
        });
    } catch (error) {
        console.error('Error loading products:', error);
    }
}

// Buscar productos en modal de selección
function searchProductsModal() {
    const search = document.getElementById('product-search-modal').value.toLowerCase();
    const rows = document.querySelectorAll('#products-selection-table tbody tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(search) ? '' : 'none';
    });
}

// Seleccionar producto para movimiento
function selectProduct(productId) {
    const product = movementProducts.find(p => p.id === productId);
    if (!product) return;
    
    if (typeof closeModal === 'function') {
        closeModal('product-selection-modal');
    } else {
        const productModal = document.getElementById('product-selection-modal');
        if (productModal) productModal.style.display = 'none';
    }

    const movementModal = document.getElementById('movement-modal');
    if (movementModal) movementModal.style.display = 'flex';

    const movementType = document.getElementById('movement-type').value;
    const defaultUnitCost = movementType === 'ENTRADA' && movementCurrencyCode !== 'USD'
        ? (parseNumberSafe(product.unitCost) / (movementCurrencyRate || 1))
        : parseNumberSafe(product.unitCost);

    // Agregar el producto a la lista interna
    movementDetails.push({
        productId: product.id,
        product: product,
        quantity: 1,
        unitCost: defaultUnitCost,
        total: defaultUnitCost
    });

    renderMovementDetails({ focusIndex: movementDetails.length - 1 });
}

function getMovementFormScrollEl() {
    return document.getElementById('movement-form-scroll')
        || document.querySelector('#movement-modal .movement-form-scroll');
}

function focusMovementDetailRow(index) {
    requestAnimationFrame(() => {
        const row = document.querySelector(`#movement-details-body tr[data-detail-index="${index}"]`);
        if (!row) return;

        const scrollEl = getMovementFormScrollEl();
        if (scrollEl) {
            const scrollRect = scrollEl.getBoundingClientRect();
            const rowRect = row.getBoundingClientRect();
            const toolbar = document.getElementById('movement-details-toolbar');
            const toolbarHeight = toolbar ? toolbar.offsetHeight + 8 : 0;
            const offset = rowRect.top - scrollRect.top + scrollEl.scrollTop - toolbarHeight - 12;
            scrollEl.scrollTo({ top: Math.max(0, offset), behavior: 'smooth' });
        } else {
            row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }

        window.setTimeout(() => {
            const qtyInput = row.querySelector('td:nth-child(2) input[type="number"]');
            if (qtyInput) {
                qtyInput.focus();
                qtyInput.select();
            }
        }, 280);
    });
}

// Renderizar detalles del movimiento
function renderMovementDetails(options = {}) {
    const tbody = document.getElementById('movement-details-body');
    tbody.innerHTML = '';
    
    let total = 0;
    const movementType = document.getElementById('movement-type').value;
        const currencyCode = movementType === 'ENTRADA' ? (document.getElementById('movement-currency')?.value || 'USD') : 'USD';
        const rateAtTransaction = movementType === 'ENTRADA' ? movementCurrencyRate : 1;
    
    const compact = typeof isCompactListView === 'function' && isCompactListView();

    movementDetails.forEach((detail, index) => {
        const row = document.createElement('tr');
        row.dataset.detailIndex = String(index);
        if (movementType === 'SALIDA') {
            detail.unitCost = parseNumberSafe(detail.product?.unitCost || detail.unitCost);
        }
        const detailTotal = (parseNumberSafe(detail.quantity) || 0) * (parseNumberSafe(detail.unitCost) || 0);
        total += detailTotal;

        if (compact) {
            row.className = 'table-compact-row';
            row.innerHTML = `
                <td colspan="5" class="table-compact-cell">
                    <div class="list-item-card list-item-card--detail">
                        <div class="list-item-body">
                            <div class="list-item-title">${escapeHtml(detail.product?.name || '')}</div>
                            <div class="list-item-sub">Cód. ${escapeHtml(detail.product?.code || '')} · Stock ${formatNumber(detail.product?.stock || 0)} ${formatUnit(detail.product?.unit)}</div>
                            <div class="detail-fields-row">
                                <label class="detail-field">
                                    <span>Cantidad</span>
                                    <input type="number" class="form-control" value="${detail.quantity}" min="0.01" step="0.01"
                                           onchange="updateMovementDetail(${index}, 'quantity', this.value)">
                                </label>
                                <label class="detail-field">
                                    <span>Costo unit.</span>
                                    <input type="number" class="form-control" value="${detail.unitCost}" min="0" step="0.01"
                                           ${movementType === 'SALIDA' ? 'disabled' : ''}
                                           onchange="updateMovementDetail(${index}, 'unitCost', this.value)">
                                </label>
                            </div>
                            <div class="list-item-amount">${buildDualCurrencyHtml(detailTotal, currencyCode, rateAtTransaction)}</div>
                        </div>
                        <div class="list-item-actions">
                            <button type="button" class="btn btn-sm btn-danger" onclick="removeMovementDetail(${index})" title="Quitar" aria-label="Quitar">
                                <i class="fas fa-times"></i>
                            </button>
                        </div>
                    </div>
                </td>
            `;
        } else {
            row.innerHTML = `
                <td>
                    <strong>${detail.product?.name || ''}</strong><br>
                    <small>Código: ${detail.product?.code || ''} | Stock: ${formatNumber(detail.product?.stock || 0)} ${formatUnit(detail.product?.unit)}</small>
                </td>
                <td>
                    <input type="number" class="form-control" 
                           value="${detail.quantity}" 
                           min="0.01" step="0.01"
                           onchange="updateMovementDetail(${index}, 'quantity', this.value)">
                </td>
                <td>
                    <input type="number" class="form-control" 
                           value="${detail.unitCost}" 
                           min="0" step="0.01"
                           ${movementType === 'SALIDA' ? 'disabled' : ''}
                           onchange="updateMovementDetail(${index}, 'unitCost', this.value)">
                </td>
                <td>${buildDualCurrencyHtml(detailTotal, currencyCode, rateAtTransaction)}</td>
                <td>
                    <button class="btn btn-sm btn-danger" onclick="removeMovementDetail(${index})">
                        <i class="fas fa-times"></i>
                    </button>
                </td>
            `;
        }

        tbody.appendChild(row);
    });
    
    document.getElementById('movement-total').innerHTML = buildDualCurrencyHtml(total, currencyCode, rateAtTransaction);

    if (options.focusIndex !== undefined && options.focusIndex >= 0) {
        focusMovementDetailRow(options.focusIndex);
    }
}

// Actualizar detalle del movimiento
function updateMovementDetail(index, field, value) {
    if (index >= 0 && index < movementDetails.length) {
        movementDetails[index][field] = parseFloat(value);
        
        // Recalcular total
        movementDetails[index].total = 
            movementDetails[index].quantity * movementDetails[index].unitCost;
        
        renderMovementDetails();
    }
}

// Remover detalle del movimiento
function removeMovementDetail(index) {
    if (index >= 0 && index < movementDetails.length) {
        movementDetails.splice(index, 1);
        renderMovementDetails();
    }
}

// Guardar movimiento
async function saveMovement() {
    const type = document.getElementById('movement-type').value;
    const date = document.getElementById('movement-date').value;
    const documentNumber = document.getElementById('movement-document').value;
    const description = document.getElementById('movement-description').value;
    
    let clientId, costCenterId;
    
    if (type === 'ENTRADA') {
        clientId = document.getElementById('movement-client').value;
        if (!clientId) {
            showAlert('Por favor, seleccione un proveedor', 'warning');
            return;
        }
    } else {
        costCenterId = document.getElementById('movement-cost-center').value;
        if (!costCenterId) {
            showAlert('Por favor, seleccione un centro de costo', 'warning');
            return;
        }
    }

    let counterpartAccountId;
    const counterpartSection = document.getElementById('movement-counterpart-section');
    const counterpartSelect = document.getElementById('movement-counterpart');
    if (counterpartSection && counterpartSection.style.display !== 'none') {
        counterpartAccountId = counterpartSelect?.value;
        if (!counterpartAccountId) {
            showAlert('Seleccione la cuenta de contrapartida contable', 'warning');
            return;
        }
    }

    if (movementDetails.length === 0) {
        showAlert('Por favor, agregue al menos un producto', 'warning');
        return;
    }
    
    // Validar stock para salidas
    if (type === 'SALIDA') {
        for (const detail of movementDetails) {
            if (detail.quantity > (detail.product?.stock || 0)) {
                showAlert(`Stock insuficiente para ${detail.product?.name || 'N/A'}. Stock actual: ${detail.product?.stock || 0}`, 'error');
                return;
            }
        }
    }
    
    const movementData = {
        type: type,
        date: date,
        documentNumber: documentNumber || undefined,
        description: description || undefined,
        clientId: clientId ? parseInt(clientId) : undefined,
        costCenterId: costCenterId ? parseInt(costCenterId) : undefined,
        counterpartAccountId: counterpartAccountId ? parseInt(counterpartAccountId) : undefined,
        currencyCode: type === 'ENTRADA' ? (document.getElementById('movement-currency')?.value || 'USD') : undefined,
        rateAtTransaction: type === 'ENTRADA' ? movementCurrencyRate : 1,
        details: movementDetails.map(detail => ({
            productId: detail.productId,
            quantity: parseFloat(detail.quantity) || 0,
            unitCost: parseFloat(detail.unitCost) || 0
        }))
    };
    
    try {
        console.log('saveMovement: enviando', movementData);

        const response = await apiRequest('/movements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(movementData),
            suppressErrorAlert: true
        });

        console.log('saveMovement: respuesta', response);

        // Validar respuesta si la API devuelve un objeto con status/error en lugar de lanzar
        if (!response) {
            throw new Error('No hubo respuesta del servidor');
        }
        if (response.status && response.status >= 400) {
            const msg = response.message || response.error || `Error del servidor: ${response.status}`;
            throw new Error(msg);
        }
        if (response.error) {
            throw new Error(response.error || 'Error desconocido al guardar el movimiento');
        }

        showAlert('Movimiento guardado exitosamente', 'success');

        // Proteger las llamadas que pueden fallar o no existir en algunos entornos
        try {
            if (typeof window.closeModal === 'function') {
                // Si la función soporta id, pasar el id del modal; si no, se ignorará.
                try { closeModal('movement-modal'); } catch (e) { closeModal(); }
            } else {
                const movementModal = document.getElementById('movement-modal');
                if (movementModal) {
                    movementModal.classList.remove('active');
                    movementModal.style.display = 'none';
                }
            }
        } catch (e) {
            console.warn('saveMovement: error al cerrar modal', e);
        }

        try {
            loadMovements(1);
        } catch (e) {
            console.warn('saveMovement: loadMovements falló', e);
        }

        try {
            if (typeof loadDashboard === 'function') loadDashboard();
        } catch (e) {
            console.warn('saveMovement: loadDashboard falló', e);
        }

    } catch (error) {
        console.error('Error saving movement:', error);
        const message = error.message || '';

        if (message.includes('requiere contraseña de administrador') || message.includes('no puede enviarse a un centro de costo de ayuda')) {
            showAlert('Este movimiento requiere validación con contraseña de administrador.', 'warning');
            openAdminPasswordModal(movementData, message);
            return;
        }

        showAlert(message || 'Error al guardar el movimiento', 'error');
    }
}

async function sendMovementData(movementData) {
    const response = await apiRequest('/movements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(movementData),
        suppressErrorAlert: true
    });

    if (!response) {
        throw new Error('No hubo respuesta del servidor');
    }
    if (response.status && response.status >= 400) {
        const msg = response.message || response.error || `Error del servidor: ${response.status}`;
        throw new Error(msg);
    }
    if (response.error) {
        throw new Error(response.error || 'Error desconocido al guardar el movimiento');
    }

    return response;
}

function openAdminPasswordModal(movementData, message) {
    pendingMovementOverrideData = movementData;
    const hintEl = document.getElementById('admin-password-hint');
    const inputEl = document.getElementById('admin-password-input');
    const errorEl = document.getElementById('admin-password-error');

    if (hintEl) {
        hintEl.textContent = message || 'Para forzar esta salida se requiere la contraseña de un administrador.';
    }
    if (inputEl) {
        inputEl.value = '';
        inputEl.focus();
    }
    if (errorEl) {
        errorEl.textContent = '';
    }

    showModal('admin-password-modal');
}

async function confirmAdminPasswordOverride() {
    const inputEl = document.getElementById('admin-password-input');
    const errorEl = document.getElementById('admin-password-error');

    if (!inputEl) return;

    const password = inputEl.value?.trim();
    if (!password) {
        if (errorEl) errorEl.textContent = 'Debe ingresar la contraseña de administrador.';
        return;
    }
    if (!pendingMovementOverrideData) {
        showAlert('No hay datos de movimiento disponibles para validar.', 'error');
        closeModal('admin-password-modal');
        return;
    }

    pendingMovementOverrideData.adminPassword = password;

    try {
        await sendMovementData(pendingMovementOverrideData);
        pendingMovementOverrideData = null;
        closeModal('admin-password-modal');
        showAlert('Movimiento guardado exitosamente', 'success');
        try { if (typeof window.closeModal === 'function') { try { closeModal('movement-modal'); } catch (e) { closeModal(); } } else {
            const movementModal = document.getElementById('movement-modal');
            if (movementModal) {
                movementModal.classList.remove('active');
                movementModal.style.display = 'none';
            }
        } } catch (e) { console.warn('confirmAdminPasswordOverride: error al cerrar modal', e); }
        try { loadMovements(1); } catch (e) { console.warn('confirmAdminPasswordOverride: loadMovements falló', e); }
        try { if (typeof loadDashboard === 'function') loadDashboard(); } catch (e) { console.warn('confirmAdminPasswordOverride: loadDashboard falló', e); }
    } catch (retryError) {
        console.error('Error saving movement with admin override:', retryError);
        if (errorEl) {
            errorEl.textContent = retryError.message || 'Error al validar la contraseña de administrador';
        } else {
            showAlert(retryError.message || 'Error al validar la contraseña de administrador', 'error');
        }
    }
}

function normalizeMovementForView(raw) {
    const movement = raw?.data || raw || {};
    if (movement.details && Array.isArray(movement.details)) {
        movement.details = movement.details.map(d => ({
            ...d,
            quantity: parseNumberSafe(d.quantity),
            unitCost: parseNumberSafe(d.unitCost),
            totalCost: parseNumberSafe(d.totalCost),
        }));
    }
    if (movement.rateAtTransaction !== undefined) {
        movement.rateAtTransaction = parseNumberSafe(movement.rateAtTransaction) || 1;
    }
    return movement;
}

function renderMovementDetailModal(movement) {
    const isEntry = movement.type === 'ENTRADA';
    const typeLabel = isEntry ? 'Entrada' : 'Salida';
    const badgeEl = document.getElementById('movement-detail-type-badge');
    const titleEl = document.getElementById('movement-detail-title');
    const subtitleEl = document.getElementById('movement-detail-subtitle');
    const bodyEl = document.getElementById('movement-detail-body');
    const printBtn = document.getElementById('movement-detail-print-btn');

    if (badgeEl) {
        badgeEl.textContent = typeLabel;
        badgeEl.className = `status-badge ${isEntry ? 'status-active' : 'status-inactive'}`;
    }
    if (titleEl) {
        titleEl.textContent = `${typeLabel} de inventario`;
    }
    if (subtitleEl) {
        const doc = movement.documentNumber ? `Doc. ${movement.documentNumber}` : `Movimiento #${movement.id}`;
        subtitleEl.textContent = `${doc} · ${formatDate(movement.date)}`;
    }

    const partyLabel = isEntry ? 'Proveedor' : 'Centro de costo';
    const partyName = isEntry
        ? (movement.client?.name || '—')
        : (movement.costCenter?.name || '—');
    const currency = (movement.currencyCode || 'USD').toUpperCase();
    const rate = parseNumberSafe(movement.rateAtTransaction) || 1;
    const details = movement.details || [];
    const total = details.reduce((sum, d) => sum + (parseNumberSafe(d.totalCost) || 0), 0);

    const productsRows = details.length
        ? details.map(detail => {
            const product = detail.product || {};
            const code = product.code || detail.code || '—';
            const name = product.name || detail.product || '—';
            const unit = formatUnit(product.unit || detail.unit);
            const qty = parseNumberSafe(detail.quantity) || 0;
            const unitCost = parseNumberSafe(detail.unitCost) || 0;
            const lineTotal = parseNumberSafe(detail.totalCost) || 0;
            return `
                <tr>
                    <td class="cell-compact"><code class="movement-detail-code">${escapeHtml(code)}</code></td>
                    <td class="cell-text">${escapeHtml(name)}</td>
                    <td class="cell-numeric text-right">${formatNumber(qty)}</td>
                    <td class="cell-compact">${escapeHtml(unit)}</td>
                    <td class="cell-currency text-right">${formatCurrency(unitCost, currency)}</td>
                    <td class="cell-currency text-right">${formatCurrency(lineTotal, currency)}</td>
                </tr>
            `;
        }).join('')
        : `<tr><td colspan="6" class="text-center movement-detail-empty">Sin productos registrados</td></tr>`;

    if (bodyEl) {
        bodyEl.innerHTML = `
            <div class="movement-detail-meta">
                <div class="movement-detail-meta-item">
                    <label>Fecha</label>
                    <span>${escapeHtml(formatDate(movement.date))}</span>
                </div>
                <div class="movement-detail-meta-item">
                    <label>${escapeHtml(partyLabel)}</label>
                    <span>${escapeHtml(partyName)}</span>
                </div>
                <div class="movement-detail-meta-item">
                    <label>Moneda</label>
                    <span>${escapeHtml(currency)}${currency !== 'USD' ? ` · Tasa ${formatNumber(rate)}` : ''}</span>
                </div>
                <div class="movement-detail-meta-item">
                    <label>Registrado por</label>
                    <span>${escapeHtml(movement.user?.name || '—')}</span>
                </div>
                ${movement.description ? `
                <div class="movement-detail-meta-item movement-detail-meta-item--wide">
                    <label>Descripción</label>
                    <span>${escapeHtml(movement.description)}</span>
                </div>` : ''}
            </div>

            <h4 class="movement-detail-section-title">
                <i class="fas fa-boxes"></i> Productos (${details.length})
            </h4>
            <div class="table-responsive movement-detail-products">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Código</th>
                            <th>Producto</th>
                            <th class="text-right">Cantidad</th>
                            <th>Unidad</th>
                            <th class="text-right">Costo unit.</th>
                            <th class="text-right">Total</th>
                        </tr>
                    </thead>
                    <tbody>${productsRows}</tbody>
                </table>
            </div>

            <div class="movement-detail-total">
                <span>Total del movimiento</span>
                <strong>${formatCurrency(total, currency)}</strong>
            </div>
            <p class="text-muted" style="margin-top:10px;font-size:0.82rem;">
                <i class="fas fa-info-circle"></i>
                Equivalente aproximado: ${buildDualCurrencyHtml(total, currency, rate)}
            </p>
        `;
    }

    if (printBtn) {
        printBtn.onclick = () => printVoucher(movement.id);
    }
}

// Ver movimiento (informe resumido en modal)
async function viewMovement(id) {
    const bodyEl = document.getElementById('movement-detail-body');
    try {
        if (bodyEl) {
            bodyEl.innerHTML = `
                <div class="movement-detail-loading text-center">
                    <div class="spinner"></div>
                    <p class="text-muted">Cargando información…</p>
                </div>
            `;
        }
        showModal('movement-detail-modal');

        await refreshMovementCurrencyRates();
        const response = await apiRequest(`/movements/${id}`);
        const movement = normalizeMovementForView(response);
        if (!movement?.id) {
            throw new Error('Movimiento no encontrado');
        }
        renderMovementDetailModal(movement);
    } catch (error) {
        closeModal('movement-detail-modal');
        showAlert(error.message || 'Error al cargar el movimiento', 'error');
    }
}

// Imprimir voucher
async function printVoucher(id) {
    try {
        const voucher = await apiRequest(`/movements/${id}/voucher`);
        const logoUrl = await getCompanyLogoForDocument();
        
        // Crear contenido HTML para el voucher
        const voucherContent = createVoucherHTML(voucher, logoUrl);
        
        // Crear ventana de impresión
        const printWindow = window.open('', '_blank');
        printWindow.document.write(`
            <html>
                <head>
                    <title>Voucher ${voucher.type === 'ENTRADA' ? 'Entrada' : 'Salida'} - ${voucher.id}</title>
                    <link rel="stylesheet" href="css/print.css">
                    <style>
                        body { font-family: Arial, sans-serif; margin: 20mm; }
                        .voucher-header { text-align: center; margin-bottom: 20px; }
                        .company-logo { max-width: 150px; max-height: 100px; }
                        .voucher-details { margin: 20px 0; }
                        .voucher-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
                        .voucher-table th, .voucher-table td { border: 1px solid #000; padding: 8px; }
                        .voucher-total-row td { font-weight: bold; }
                        .voucher-total-label { text-align: right; }
                        .signature { margin-top: 50px; }
                    </style>
                </head>
                <body>
                    ${voucherContent}
                </body>
            </html>
        `);
        
        printWindow.document.close();
        printWindow.focus();
        
        setTimeout(() => {
            printWindow.print();
            printWindow.close();
        }, 250);
        
    } catch (error) {
        showAlert('Error al generar el voucher', 'error');
    }
}

async function getCompanyLogoForDocument() {
    try {
        const company = await apiRequest('/company');
        if (!company?.logo) return null;

        const backendBase = (typeof API_BASE_URL !== 'undefined')
            ? API_BASE_URL.replace(/\/api\/?$/, '')
            : `${window.location.protocol}//${window.location.hostname}:3000`;

        let logoUrl = String(company.logo).replace(/\\/g, '/');
        if (/^https?:\/\//i.test(logoUrl)) {
            const u = new URL(logoUrl);
            logoUrl = `${u.origin}${u.pathname}`;
        } else if (logoUrl.startsWith('/uploads/')) {
            logoUrl = `${backendBase}${logoUrl}`;
        } else if (logoUrl.includes('/uploads/')) {
            logoUrl = `${backendBase}${logoUrl.substring(logoUrl.indexOf('/uploads/'))}`;
        } else {
            return null;
        }

        const cacheKey = company.updatedAt ? new Date(company.updatedAt).getTime() : Date.now();
        return `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}v=${cacheKey}`;
    } catch (error) {
        console.warn('No se pudo cargar logo para documento:', error);
        return null;
    }
}

// Anular movimiento mediante un movimiento inverso, conservando el comprobante original.
async function reverseMovement(id) {
    const ok = confirm('¿Desea anular este movimiento? Se conservará el comprobante y se registrará un movimiento inverso.');
    if (!ok) return;
    try {
        const response = await apiRequest(`/movements/${id}/reverse`, { method: 'POST' });
        showAlert(`Movimiento anulado. Reverso: ${response.reversalDocumentNumber}`, 'success');
        try { loadMovements(1); } catch (e) { /* noop */ }
        try { if (typeof loadDashboard === 'function') loadDashboard(); } catch (e) { /* noop */ }
    } catch (error) {
        showAlert(error.message || 'Error al eliminar el movimiento', 'error');
    }
}

// Crear HTML del voucher
function createVoucherHTML(voucher, logoUrl = null) {
    const typeText = voucher.type === 'ENTRADA' ? 'ENTRADA DE PRODUCTOS' : 'SALIDA DE PRODUCTOS';
    const entity = voucher.type === 'ENTRADA' ? 'Proveedor' : 'Centro de Costo';
    const entityName = voucher.type === 'ENTRADA' 
        ? (voucher.client?.name || 'N/A')
        : (voucher.costCenter?.name || 'N/A');
    
    const total = (voucher.details || []).reduce((sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0), 0);
    const voucherRate = parseNumberSafe(voucher.rateAtTransaction) || 1;
    
    return `
        <div class="voucher-header">
            ${logoUrl ? `<img src="${logoUrl}" alt="Logo Empresa" class="company-logo" style="max-width:140px;max-height:80px;display:block;margin:0 auto 12px;">` : ''}
            <h1>${typeText}</h1>
            <div class="voucher-info">
                <p><strong>Número:</strong> ${voucher.id}</p>
                <p><strong>Fecha:</strong> ${formatDate(voucher.date)}</p>
                ${voucher.documentNumber ? `<p><strong>Documento:</strong> ${voucher.documentNumber}</p>` : ''}
            </div>
        </div>
        
        <div class="voucher-details">
            <p><strong>${entity}:</strong> ${entityName}</p>
            ${voucher.description ? `<p><strong>Descripción:</strong> ${voucher.description}</p>` : ''}
            <p><strong>Responsable:</strong> ${voucher.user?.name || 'N/A'}</p>
        </div>
        
        <table class="voucher-table">
            <thead>
                <tr>
                    <th>Código</th>
                    <th>Producto</th>
                    <th>Unidad</th>
                    <th>Cantidad</th>
                    <th>Costo Unit.</th>
                    <th>Total</th>
                </tr>
            </thead>
            <tbody>
                ${(voucher.details || []).map(detail => `
                    <tr>
                        <td>${detail.code || ''}</td>
                        <td>${detail.product?.name || detail.product || ''}</td>
                        <td>${formatUnit(detail.unit)}</td>
                        <td>${formatNumber(detail.quantity || 0)}</td>
                        <td>${buildDualCurrencyHtml(Number(detail.unitCost) || 0, voucher.currencyCode || 'USD', voucherRate)}</td>
                        <td>${buildDualCurrencyHtml(detail.totalCost, voucher.currencyCode || 'USD', voucherRate)}</td>
                    </tr>
                `).join('')}
                <tr class="voucher-total-row">
                    <td colspan="5" class="voucher-total-label">TOTAL:</td>
                    <td>${buildDualCurrencyHtml(total, voucher.currencyCode || 'USD', voucherRate)}</td>
                </tr>
            </tbody>
        </table>
        
        <div class="signature">
            <p>_________________________</p>
            <p>Firma del Responsable</p>
        </div>
    `;
}

// Cargar movimientos recientes para el dashboard
async function loadRecentMovements() {
    try {
        await refreshMovementCurrencyRates();
        const response = await apiRequest('/movements?page=1&limit=5');
        
        const tbody = document.getElementById('recent-movements').querySelector('tbody');
        tbody.innerHTML = '';
        
        if (response.data.length === 0) {
            const row = document.createElement('tr');
            row.innerHTML = `
                <td colspan="6" class="text-center">
                    No hay movimientos recientes
                </td>
            `;
            tbody.appendChild(row);
            if (typeof syncDashboardPanelHeights === 'function') syncDashboardPanelHeights();
            return;
        }
        
        // Normalizar detalles numéricos y debuggeo para detectar valores no numéricos
        response.data = (response.data || []).map(m => {
            if (m.details && Array.isArray(m.details)) {
                m.details = m.details.map(d => ({
                    ...d,
                    quantity: parseNumberSafe(d.quantity),
                    unitCost: parseNumberSafe(d.unitCost),
                    totalCost: parseNumberSafe(d.totalCost)
                }));
            }
            return m;
        });

        // Debug: log primer movimiento para inspección si hay problemas reportados
        if (response.data && response.data.length > 0) {
            const sample = response.data[0];
            console.debug('loadRecentMovements sample movement:', sample.id, sample.details && sample.details.map(d => ({quantity: d.quantity, unitCost: d.unitCost, totalCost: d.totalCost}))); 
        }

        const compact = typeof isCompactListView === 'function' && isCompactListView();

        response.data.forEach(movement => {
            const row = document.createElement('tr');
            const canDelete = isAdmin();

            if (compact) {
                row.className = 'table-compact-row';
                row.innerHTML = `<td colspan="6" class="table-compact-cell">${buildMovementListItemHtml(movement, { canDelete })}</td>`;
                tbody.appendChild(row);
                return;
            }

            let entity = '';
            if (movement.client) entity = movement.client.name;
            else if (movement.costCenter) entity = movement.costCenter.name;

            const total = (movement.details || []).reduce((sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0), 0);
            const currency = movement.currencyCode || 'USD';
            const rateAtTransaction = parseNumberSafe(movement.rateAtTransaction) || 1;

            row.innerHTML = `
                <td class="cell-compact">${formatDate(movement.date)}</td>
                <td class="cell-compact">
                    <span class="status-badge ${movement.type === 'ENTRADA' ? 'status-active' : 'status-inactive'}">
                        ${movement.type === 'ENTRADA' ? 'Entrada' : 'Salida'}
                    </span>
                </td>
                <td class="cell-text">${escapeHtml(movement.documentNumber || 'N/A')}</td>
                <td class="cell-text">${escapeHtml(entity)}</td>
                <td class="cell-currency">${buildDualCurrencyHtml(total, currency, rateAtTransaction)}</td>
                <td class="actions">
                    <button class="btn btn-sm btn-outline" onclick="viewMovement(${movement.id})">
                        <i class="fas fa-eye"></i>
                    </button>
                    ${canDelete ? `
                    <button class="btn btn-sm btn-danger" onclick="deleteMovement(${movement.id})">
                        <i class="fas fa-trash"></i>
                    </button>` : ''}
                </td>
            `;

            tbody.appendChild(row);
        });
        if (typeof syncDashboardPanelHeights === 'function') syncDashboardPanelHeights();
        
    } catch (error) {
        console.error('Error loading recent movements:', error);
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('movements-table')) {
        loadMovements();
    }

    const quickProductForm = document.getElementById('quick-product-form');
    if (quickProductForm) {
        quickProductForm.addEventListener('submit', (e) => {
            e.preventDefault();
            saveQuickProductFromMovement();
        });
    }
});
