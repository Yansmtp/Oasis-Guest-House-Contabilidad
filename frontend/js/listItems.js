/**
 * Filas compactas para listas en móvil/tablet (una tarjeta baja por registro).
 */

function buildProductListItemHtml(product, options = {}) {
    const canDelete = !!options.canDelete;
    const canEdit = !!options.canEdit;
    const stock = parseNumberSafe(product.stock);
    const minStock = parseNumberSafe(product.minStock);
    const unitCost = parseNumberSafe(product.unitCost);
    const totalValue = stock * unitCost;
    const isLowStock = stock <= minStock;
    const unit = typeof formatUnit === 'function' ? formatUnit(product.unit) : (product.unit || '');
    const statusClass = product.isActive ? 'status-active' : 'status-inactive';
    const statusText = product.isActive ? 'Activo' : 'Inactivo';
    const desc = product.description
        ? `<div class="list-item-sub">${escapeHtml(product.description)}</div>`
        : '';

    return `
        <div class="list-item-card ${isLowStock ? 'list-item-card--warn' : ''}">
            <div class="list-item-body">
                <div class="list-item-top">
                    <span class="list-item-code">${escapeHtml(product.code)}</span>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="list-item-title">${escapeHtml(product.name)}</div>
                ${desc}
                <div class="list-item-meta">
                    <span><strong>Stock:</strong> ${formatNumber(stock)} ${escapeHtml(unit)}</span>
                    <span><strong>Mín:</strong> ${formatNumber(minStock)}</span>
                    <span><strong>Costo:</strong> ${formatCurrency(unitCost)}</span>
                    <span><strong>Valor:</strong> ${formatCurrency(totalValue)}</span>
                </div>
            </div>
            <div class="list-item-actions">
                ${canEdit ? `<button type="button" class="btn btn-sm btn-outline" onclick="editProduct(${product.id})" title="Editar" aria-label="Editar">
                    <i class="fas fa-edit"></i>
                </button>` : ''}
                ${canDelete ? `
                <button type="button" class="btn btn-sm btn-outline" onclick="deleteProduct(${product.id})" title="Eliminar" aria-label="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>` : ''}
                <button type="button" class="btn btn-sm btn-outline" onclick="viewProductHistory(${product.id})" title="Historial" aria-label="Historial">
                    <i class="fas fa-history"></i>
                </button>
            </div>
        </div>
    `;
}

function buildMovementListItemHtml(movement, options = {}) {
    const canReverse = !!options.canReverse;
    const canApprove = !!options.canApprove;
    const total = (movement.details || []).reduce(
        (sum, detail) => sum + (parseNumberSafe(detail.totalCost) || 0),
        0
    );
    const currency = movement.currencyCode || 'USD';
    const rate = parseNumberSafe(movement.rateAtTransaction) || 1;
    const typeLabel = movement.type === 'ENTRADA' ? 'Entrada' : 'Salida';
    const isReversed = movement.status === 'REVERSED';
    const typeClass = isReversed ? 'status-inactive' : (movement.type === 'ENTRADA' ? 'status-active' : 'status-inactive');
    const productCount = (movement.details || []).length;

    let party = '—';
    if (movement.client) party = movement.client.name;
    else if (movement.costCenter) party = movement.costCenter.name;

    let amountHtml = formatCurrency(total, currency);
    if (typeof buildDualCurrencyHtml === 'function') {
        const cupRate = typeof movementCupRate !== 'undefined' ? parseNumberSafe(movementCupRate) : 0.0083;
        const usd = currency === 'USD' ? total : total * rate;
        const cup = cupRate > 0 ? usd / cupRate : 0;
        amountHtml = `<span>${formatCurrency(usd, 'USD')}</span> <span class="list-item-meta-muted">${formatCurrency(cup, 'CUP')}</span>`;
    }

    const desc = movement.description
        ? `<span class="list-item-meta-muted">${escapeHtml(movement.description)}</span>`
        : '';

    const statusLabels = { PENDING: 'Pendiente de aprobación', POSTED: 'Aprobado', REJECTED: 'Rechazado', REVERSED: 'Revertido' };
    const statusLabel = statusLabels[movement.status] || statusLabels.POSTED;
    const actions = `
        <button type="button" class="btn btn-sm btn-outline" onclick="viewMovement(${movement.id})" title="Ver" aria-label="Ver">
            <i class="fas fa-eye"></i>
        </button>
        ${canApprove && movement.status === 'PENDING' ? `<button type="button" class="btn btn-sm btn-primary" onclick="approveMovement(${movement.id})" title="Aprobar"><i class="fas fa-check"></i></button><button type="button" class="btn btn-sm btn-danger" onclick="rejectMovement(${movement.id})" title="Rechazar"><i class="fas fa-times"></i></button>` : ''}
        ${canReverse && movement.status === 'POSTED' ? `
        <button type="button" class="btn btn-sm btn-danger" onclick="reverseMovement(${movement.id})" title="Anular" aria-label="Anular">
            <i class="fas fa-rotate-left"></i>
        </button>` : ''}
        <button type="button" class="btn btn-sm btn-outline" onclick="printVoucher(${movement.id})" title="Imprimir" aria-label="Imprimir">
            <i class="fas fa-print"></i>
        </button>
    `;

    return `
        <div class="list-item-card list-item-card--movement">
            <div class="list-item-body">
                <div class="list-item-top list-item-top--movement">
                    <span class="status-badge ${typeClass}">${isReversed ? 'Anulado · ' : ''}${typeLabel}</span>
                    <span class="status-badge">${escapeHtml(statusLabel)}</span>
                </div>
                <div class="list-item-title">${escapeHtml(movement.documentNumber || 'Sin documento')}</div>
                <div class="list-item-date"><i class="fas fa-clock" aria-hidden="true"></i><span>${escapeHtml(formatDate(movement.date))}</span></div>
                <div class="list-item-sub">${escapeHtml(party)}</div>
                <div class="list-item-meta">
                    <span>${productCount} producto(s)</span>
                    ${desc}
                    <span class="list-item-amount">${amountHtml}</span>
                </div>
            </div>
            <div class="list-item-actions">${actions}</div>
        </div>
    `;
}

function buildClientListItemHtml(client, options = {}) {
    const canDelete = !!options.canDelete;
    const canEdit = !!options.canEdit;
    const statusClass = client.isActive ? 'status-active' : 'status-inactive';
    const statusText = client.isActive ? 'Activo' : 'Inactivo';
    const contact = [client.email, client.phone].filter(Boolean).join(' · ') || 'Sin contacto';

    return `
        <div class="list-item-card">
            <div class="list-item-body">
                <div class="list-item-top">
                    <span class="list-item-code">${escapeHtml(client.code)}</span>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="list-item-title">${escapeHtml(client.name)}</div>
                <div class="list-item-meta">
                    <span>${escapeHtml(contact)}</span>
                    ${client.taxId ? `<span><strong>RUC:</strong> ${escapeHtml(client.taxId)}</span>` : ''}
                </div>
            </div>
            <div class="list-item-actions">
                ${canEdit ? `<button type="button" class="btn btn-sm btn-outline" onclick="editClient(${client.id})" title="Editar" aria-label="Editar">
                    <i class="fas fa-edit"></i>
                </button>` : ''}
                ${canDelete ? `
                <button type="button" class="btn btn-sm btn-outline" onclick="deleteClient(${client.id})" title="Eliminar" aria-label="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>` : ''}
                <button type="button" class="btn btn-sm btn-outline" onclick="viewClientMovements(${client.id})" title="Movimientos" aria-label="Movimientos">
                    <i class="fas fa-exchange-alt"></i>
                </button>
            </div>
        </div>
    `;
}

function buildCostCenterListItemHtml(center, options = {}) {
    const canDelete = !!options.canDelete;
    const canEdit = !!options.canEdit;
    const statusClass = center.isActive ? 'status-active' : 'status-inactive';
    const statusText = center.isActive ? 'Activo' : 'Inactivo';
    const desc = center.description
        ? `<div class="list-item-sub">${escapeHtml(center.description)}</div>`
        : '';

    return `
        <div class="list-item-card">
            <div class="list-item-body">
                <div class="list-item-top">
                    <span class="list-item-code">${escapeHtml(center.code)}</span>
                    <span class="status-badge ${statusClass}">${statusText}</span>
                </div>
                <div class="list-item-title">${escapeHtml(center.name)}</div>
                ${desc}
            </div>
            <div class="list-item-actions">
                ${canEdit ? `<button type="button" class="btn btn-sm btn-outline" onclick="editCostCenter(${center.id})" title="Editar" aria-label="Editar">
                    <i class="fas fa-edit"></i>
                </button>` : ''}
                ${canDelete ? `
                <button type="button" class="btn btn-sm btn-outline" onclick="deleteCostCenter(${center.id})" title="Eliminar" aria-label="Eliminar">
                    <i class="fas fa-trash"></i>
                </button>` : ''}
                <button type="button" class="btn btn-sm btn-outline" onclick="viewCostCenterMovements(${center.id})" title="Movimientos" aria-label="Movimientos">
                    <i class="fas fa-exchange-alt"></i>
                </button>
            </div>
        </div>
    `;
}

function buildUserListItemHtml(user) {
    const roleClass = user.role === 'ADMIN' ? 'status-active' : 'status-inactive';
    const roleLabel = ({ ADMIN: 'Administrador', WAREHOUSE: 'Almacén', USER: 'Almacén', VIEWER: 'Solo lectura' })[user.role] || 'Usuario';
    return `
        <div class="list-item-card">
            <div class="list-item-body">
                <div class="list-item-top">
                    <span class="list-item-code">${escapeHtml(user.email || '')}</span>
                    <span class="status-badge ${roleClass}">${escapeHtml(roleLabel)}</span>
                </div>
                <div class="list-item-title">${escapeHtml(user.name || '')}</div>
                <div class="list-item-meta">
                    <span>Alta: ${escapeHtml(formatDate(user.createdAt))}</span>
                </div>
            </div>
            <div class="list-item-actions">
                <button type="button" class="btn btn-sm btn-outline" onclick="editUser(${user.id})" title="Editar" aria-label="Editar">
                    <i class="fas fa-edit"></i>
                </button>
            </div>
        </div>
    `;
}
