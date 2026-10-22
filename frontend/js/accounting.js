// =========================================================
// Contabilidad (cuentas, períodos, asientos, balanza, apertura)
// =========================================================
let accountingAccounts = [];
let accountingPeriods = [];
let accountingCostCenters = [];
let accountingCompanyContext = null;
let journalEntryDraftLines = [];
let openingProducts = [];

const ACCOUNT_TYPES = {
    ASSET: 'Activo',
    LIABILITY: 'Pasivo',
    EQUITY: 'Patrimonio',
    REVENUE: 'Ingresos',
    EXPENSE: 'Gastos'
};

const JOURNAL_STATUS = {
    DRAFT: 'Borrador',
    POSTED: 'Contabilizado',
    REVERSED: 'Revertido'
};

const JOURNAL_KINDS = {
    GENERAL: 'General',
    INVENTORY_OPENING: 'Apertura de inventario',
    INVENTORY_MOVEMENT: 'Movimiento de inventario',
    REVERSAL: 'Reverso'
};

// ---------- Contexto de la empresa / apertura contable ----------
async function refreshAccountingContext() {
    accountingCompanyContext = await apiRequest('/company');
    return accountingCompanyContext;
}

function isAccountingCutoverActive() {
    return !!(accountingCompanyContext && accountingCompanyContext.accountingCutoverAt);
}

function renderAccountingStatus() {
    const card = document.getElementById('accounting-status-card');
    const content = document.getElementById('accounting-status-content');
    if (!card || !content) return;
    card.style.display = 'block';
    const ctx = accountingCompanyContext;
    const currency = escapeHtml(ctx?.functionalCurrencyCode || 'USD');
    if (isAccountingCutoverActive()) {
        content.innerHTML = `
            <div class="d-flex align-items-center gap-3 flex-wrap">
                <span class="status-badge status-active">Apertura contable activa</span>
                <span>Corte: <strong>${formatDate(ctx.accountingCutoverAt)}</strong></span>
                <span>Moneda funcional: <strong>${currency}</strong></span>
                <span class="text-muted">Los movimientos requieren cuenta de contrapartida.</span>
            </div>`;
    } else {
        content.innerHTML = `
            <div class="d-flex align-items-center gap-3 flex-wrap">
                <span class="status-badge status-inactive">Sin apertura contable</span>
                <span>Moneda funcional: <strong>${currency}</strong></span>
                <span class="text-muted">Use la pestaña <strong>Apertura</strong> para activar el libro mayor.</span>
            </div>`;
    }
}

// Carga inicial de la sección
async function loadAccounting() {
    if (!isAdmin()) return;
    try {
        await Promise.all([
            refreshAccountingContext(),
            loadAccountingAccounts(),
            loadAccountingPeriods()
        ]);
        renderAccountingStatus();
        await loadJournalEntries();
    } catch (error) {
        showAlert(error.message || 'Error al cargar contabilidad', 'error');
    }
}

// ---------- Pestañas ----------
function switchAccountingTab(tab) {
    document.querySelectorAll('.accounting-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });
    ['journal', 'accounts', 'periods', 'trial', 'opening'].forEach(name => {
        const panel = document.getElementById(`accounting-panel-${name}`);
        if (panel) panel.style.display = name === tab ? 'block' : 'none';
    });

    if (tab === 'journal') loadJournalEntries();
    if (tab === 'accounts') renderAccountsTable();
    if (tab === 'periods') renderPeriodsTable();
    if (tab === 'opening') loadInventoryOpeningPanel();
}

// ---------- Cuentas ----------
async function loadAccountingAccounts() {
    const res = await apiRequest('/accounting/accounts', { suppressErrorAlert: true });
    accountingAccounts = res?.data || [];
    renderAccountsTable();
    populateAccountParentOptions();
}

function renderAccountsTable() {
    const tbody = document.querySelector('#accounts-table tbody');
    if (!tbody) return;

    const term = (document.getElementById('account-search')?.value || '').trim().toLowerCase();
    const rows = accountingAccounts.filter(a =>
        !term ||
        String(a.code).toLowerCase().includes(term) ||
        String(a.name).toLowerCase().includes(term) ||
        (ACCOUNT_TYPES[a.type] || '').toLowerCase().includes(term)
    );

    if (!rows.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay cuentas registradas. Cree la primera con "Nueva Cuenta".</td></tr>';
        return;
    }

    tbody.innerHTML = rows.map(a => `
        <tr>
            <td><strong>${escapeHtml(a.code)}</strong></td>
            <td>
                ${escapeHtml(a.name)}
                ${a.description ? `<br><small class="text-muted">${escapeHtml(a.description)}</small>` : ''}
            </td>
            <td><span class="status-badge status-active">${ACCOUNT_TYPES[a.type] || escapeHtml(a.type)}</span></td>
            <td>${a.parent ? escapeHtml(`${a.parent.code} - ${a.parent.name}`) : '—'}</td>
            <td><span class="status-badge ${a.isActive ? 'status-active' : 'status-inactive'}">${a.isActive ? 'Activa' : 'Inactiva'}</span></td>
            <td class="actions">
                <button class="btn btn-sm btn-outline" onclick="editAccount(${a.id})" title="Editar">
                    <i class="fas fa-edit"></i>
                </button>
                <button class="btn btn-sm ${a.isActive ? 'btn-danger' : 'btn-success'}"
                        onclick="toggleAccountActive(${a.id}, ${a.isActive ? 'false' : 'true'})"
                        title="${a.isActive ? 'Desactivar' : 'Activar'}">
                    <i class="fas fa-${a.isActive ? 'ban' : 'check'}"></i>
                </button>
            </td>
        </tr>`).join('');
}

function openAccountModal(account = null) {
    const form = document.getElementById('account-form');
    if (form) form.reset();

    const editing = !!account;
    document.getElementById('account-id').value = account?.id || '';
    document.getElementById('account-code').value = account?.code || '';
    document.getElementById('account-name').value = account?.name || '';
    document.getElementById('account-type').value = account?.type || 'ASSET';
    document.getElementById('account-description').value = account?.description || '';
    document.getElementById('account-active').checked = account ? !!account.isActive : true;
    document.getElementById('account-modal-title').textContent = editing ? 'Editar Cuenta' : 'Nueva Cuenta';

    // El backend solo permite editar nombre/descripción/estado
    document.getElementById('account-code').disabled = editing;
    document.getElementById('account-type').disabled = editing;

    populateAccountParentOptions(account?.parentId || null);
    showModal('account-modal');
}

function editAccount(id) {
    const account = accountingAccounts.find(a => a.id === id);
    if (account) openAccountModal(account);
}

function populateAccountParentOptions(selectedParentId = null) {
    const select = document.getElementById('account-parent');
    if (!select) return;

    const type = document.getElementById('account-type')?.value;
    const currentId = parseInt(document.getElementById('account-id')?.value) || null;
    const editing = !!document.getElementById('account-id')?.value;

    select.innerHTML = '<option value="">Sin cuenta padre</option>';
    accountingAccounts
        .filter(a => a.isActive && a.type === type && a.id !== currentId)
        .forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.code} - ${a.name}`;
            if (selectedParentId && a.id === selectedParentId) opt.selected = true;
            select.appendChild(opt);
        });

    select.disabled = editing;
}

function closeAccountModal() {
    closeModal();
}

async function saveAccount() {
    const id = document.getElementById('account-id').value;
    const code = (document.getElementById('account-code').value || '').trim();
    const name = (document.getElementById('account-name').value || '').trim();
    const type = document.getElementById('account-type').value;
    const description = (document.getElementById('account-description').value || '').trim();
    const parentId = document.getElementById('account-parent').value;
    const isActive = document.getElementById('account-active').checked;

    if (!code || !name) {
        showAlert('El código y el nombre son obligatorios', 'warning');
        return;
    }

    try {
        if (id) {
            await apiRequest(`/accounting/accounts/${id}`, {
                method: 'PATCH',
                body: JSON.stringify({ name, description: description || undefined, isActive })
            });
            showAlert('Cuenta actualizada', 'success');
        } else {
            await apiRequest('/accounting/accounts', {
                method: 'POST',
                body: JSON.stringify({
                    code,
                    name,
                    type,
                    description: description || undefined,
                    parentId: parentId ? parseInt(parentId) : undefined
                })
            });
            showAlert('Cuenta creada', 'success');
        }
        closeModal();
        await loadAccountingAccounts();
    } catch (error) {
        showAlert(error.message || 'Error al guardar la cuenta', 'error');
    }
}

async function toggleAccountActive(id, isActive) {
    try {
        await apiRequest(`/accounting/accounts/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({ isActive })
        });
        showAlert(isActive ? 'Cuenta activada' : 'Cuenta desactivada', 'success');
        await loadAccountingAccounts();
    } catch (error) {
        showAlert(error.message || 'Error al actualizar la cuenta', 'error');
    }
}

// ---------- Períodos ----------
async function loadAccountingPeriods() {
    const res = await apiRequest('/accounting/periods', { suppressErrorAlert: true });
    accountingPeriods = res?.data || [];
    renderPeriodsTable();
}

function renderPeriodsTable() {
    const tbody = document.querySelector('#periods-table tbody');
    if (!tbody) return;

    if (!accountingPeriods.length) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center">No hay períodos. Cree uno para poder contabilizar asientos.</td></tr>';
        return;
    }

    tbody.innerHTML = accountingPeriods.map(p => `
        <tr>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td>${formatDate(p.startsAt)}</td>
            <td>${formatDate(p.endsAt)}</td>
            <td><span class="status-badge ${p.status === 'OPEN' ? 'status-active' : 'status-inactive'}">${p.status === 'OPEN' ? 'Abierto' : 'Cerrado'}</span></td>
            <td>${p.closedBy ? escapeHtml(p.closedBy.name) : '—'}</td>
            <td class="actions">
                ${p.status === 'OPEN' ? `
                    <button class="btn btn-sm btn-danger" onclick="closeAccountingPeriod(${p.id})" title="Cerrar período">
                        <i class="fas fa-lock"></i>
                    </button>` : ''}
            </td>
        </tr>`).join('');
}

function openPeriodModal() {
    const form = document.getElementById('period-form');
    if (form) form.reset();

    const year = new Date().getFullYear();
    document.getElementById('period-name').value = `${year}`;
    document.getElementById('period-start').value = `${year}-01-01`;
    document.getElementById('period-end').value = `${year}-12-31`;
    showModal('period-modal');
}

async function savePeriod() {
    const name = (document.getElementById('period-name').value || '').trim();
    const startsAt = document.getElementById('period-start').value;
    const endsAt = document.getElementById('period-end').value;

    if (!name || !startsAt || !endsAt) {
        showAlert('Nombre y fechas son obligatorios', 'warning');
        return;
    }

    try {
        await apiRequest('/accounting/periods', {
            method: 'POST',
            body: JSON.stringify({ name, startsAt, endsAt })
        });
        showAlert('Período creado', 'success');
        closeModal();
        await loadAccountingPeriods();
    } catch (error) {
        showAlert(error.message || 'Error al crear el período', 'error');
    }
}

async function closeAccountingPeriod(id) {
    const ok = confirm('¿Cerrar este período? Una vez cerrado no se podrán contabilizar asientos dentro de él.');
    if (!ok) return;

    try {
        await apiRequest(`/accounting/periods/${id}/close`, { method: 'POST' });
        showAlert('Período cerrado', 'success');
        await loadAccountingPeriods();
    } catch (error) {
        showAlert(error.message || 'Error al cerrar el período', 'error');
    }
}

// ---------- Asientos contables ----------
async function loadJournalEntries() {
    try {
        const start = document.getElementById('journal-filter-start')?.value;
        const end = document.getElementById('journal-filter-end')?.value;
        const status = document.getElementById('journal-filter-status')?.value;

        const params = new URLSearchParams();
        if (start) params.set('startDate', start);
        if (end) params.set('endDate', end);
        if (status) params.set('status', status);
        const qs = params.toString();

        const res = await apiRequest(`/accounting/journal-entries${qs ? `?${qs}` : ''}`, { suppressErrorAlert: true });
        renderJournalEntriesTable(res?.data || []);
    } catch (error) {
        showAlert(error.message || 'Error al cargar asientos', 'error');
    }
}

function renderJournalEntriesTable(entries) {
    const tbody = document.querySelector('#journal-entries-table tbody');
    if (!tbody) return;

    if (!entries.length) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center">No hay asientos registrados</td></tr>';
        return;
    }

    tbody.innerHTML = entries.map(e => {
        const totalDebit = (e.lines || []).reduce((sum, line) => sum + (parseFloat(line.debit) || 0), 0);
        const number = e.formattedNumber || `JE-${String(e.entryNumber).padStart(8, '0')}`;
        const statusClass = e.status === 'POSTED' ? 'status-active' : 'status-inactive';
        return `
        <tr>
            <td><strong>${escapeHtml(number)}</strong></td>
            <td>${formatDate(String(e.date).slice(0, 10))}</td>
            <td>
                ${escapeHtml(e.description)}
                ${e.reference ? `<br><small class="text-muted">Ref: ${escapeHtml(e.reference)}</small>` : ''}
            </td>
            <td>${JOURNAL_KINDS[e.kind] || escapeHtml(e.kind)}</td>
            <td><span class="status-badge ${statusClass}">${JOURNAL_STATUS[e.status] || escapeHtml(e.status)}</span></td>
            <td>${formatNumber(totalDebit)}</td>
            <td class="actions">
                <button class="btn btn-sm btn-outline" onclick="viewJournalEntry(${e.id})" title="Ver detalle">
                    <i class="fas fa-eye"></i>
                </button>
            </td>
        </tr>`;
    }).join('');
}

function openJournalEntryModal() {
    const form = document.getElementById('journal-entry-form');
    if (form) form.reset();

    const dateDisplay = document.querySelector('#journal-entry-date-display span');
    if (dateDisplay) dateDisplay.textContent = `Hoy · ${new Date().toLocaleDateString('es-CU')}`;
    document.getElementById('journal-entry-modal-title').textContent = 'Nuevo Asiento Contable';
    journalEntryDraftLines = [
        { accountId: '', costCenterId: '', description: '', debit: 0, credit: 0 },
        { accountId: '', costCenterId: '', description: '', debit: 0, credit: 0 }
    ];

    ensureJournalSupportData().then(() => renderJournalLines());
    showModal('journal-entry-modal');
}

async function ensureJournalSupportData() {
    try {
        if (!accountingAccounts.length) {
            const res = await apiRequest('/accounting/accounts', { suppressErrorAlert: true });
            accountingAccounts = res?.data || [];
        }
        if (!accountingCostCenters.length) {
            const res = await apiRequest('/cost-centers?activeOnly=true&limit=1000', { suppressErrorAlert: true });
            accountingCostCenters = res?.data || [];
        }
    } catch (error) {
        console.error('Error loading accounting support data:', error);
    }
}

function renderJournalLines() {
    const tbody = document.getElementById('journal-lines-body');
    if (!tbody) return;

    const activeAccounts = accountingAccounts.filter(a => a.isActive);
    const accountOptions = activeAccounts.map(a =>
        `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`
    ).join('');
    const costCenterOptions = accountingCostCenters.map(c =>
        `<option value="${c.id}">${escapeHtml(c.code)} - ${escapeHtml(c.name)}</option>`
    ).join('');

    tbody.innerHTML = journalEntryDraftLines.map((line, i) => `
        <tr>
            <td>
                <select class="form-control" onchange="updateJournalLine(${i}, 'accountId', this.value)">
                    <option value="">Seleccionar cuenta</option>
                    ${accountOptions}
                </select>
            </td>
            <td>
                <select class="form-control" onchange="updateJournalLine(${i}, 'costCenterId', this.value)">
                    <option value="">—</option>
                    ${costCenterOptions}
                </select>
            </td>
            <td>
                <input type="text" class="form-control" maxlength="500"
                       value="${escapeHtml(line.description || '')}"
                       oninput="updateJournalLine(${i}, 'description', this.value)">
            </td>
            <td>
                <input type="number" class="form-control" min="0" step="0.01"
                       value="${line.debit || ''}"
                       oninput="updateJournalLine(${i}, 'debit', this.value)">
            </td>
            <td>
                <input type="number" class="form-control" min="0" step="0.01"
                       value="${line.credit || ''}"
                       oninput="updateJournalLine(${i}, 'credit', this.value)">
            </td>
            <td>
                <button type="button" class="btn btn-sm btn-danger" onclick="removeJournalLine(${i})" title="Quitar">
                    <i class="fas fa-times"></i>
                </button>
            </td>
        </tr>`).join('');

    // Sincronizar valores seleccionados
    Array.from(tbody.children).forEach((row, i) => {
        const selects = row.querySelectorAll('select');
        if (journalEntryDraftLines[i].accountId) selects[0].value = String(journalEntryDraftLines[i].accountId);
        if (journalEntryDraftLines[i].costCenterId) selects[1].value = String(journalEntryDraftLines[i].costCenterId);
    });

    recalcJournalTotals();
}

function updateJournalLine(index, field, value) {
    if (index < 0 || index >= journalEntryDraftLines.length) return;

    if (field === 'debit' || field === 'credit') {
        const amount = parseFloat(value) || 0;
        journalEntryDraftLines[index][field] = amount;

        if (amount > 0) {
            const other = field === 'debit' ? 'credit' : 'debit';
            if (journalEntryDraftLines[index][other] > 0) {
                journalEntryDraftLines[index][other] = 0;
                const row = document.getElementById('journal-lines-body')?.children[index];
                const numberInputs = row ? row.querySelectorAll('input[type="number"]') : [];
                const otherInput = numberInputs[field === 'debit' ? 1 : 0];
                if (otherInput) otherInput.value = '';
            }
        }
    } else {
        journalEntryDraftLines[index][field] = value;
    }

    recalcJournalTotals();
}

function addJournalLine() {
    journalEntryDraftLines.push({ accountId: '', costCenterId: '', description: '', debit: 0, credit: 0 });
    renderJournalLines();
}

function removeJournalLine(index) {
    journalEntryDraftLines.splice(index, 1);
    if (!journalEntryDraftLines.length) {
        journalEntryDraftLines.push({ accountId: '', costCenterId: '', description: '', debit: 0, credit: 0 });
    }
    renderJournalLines();
}

function recalcJournalTotals() {
    const debit = journalEntryDraftLines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
    const credit = journalEntryDraftLines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);

    const debitEl = document.getElementById('journal-total-debit');
    const creditEl = document.getElementById('journal-total-credit');
    const hint = document.getElementById('journal-balance-hint');

    if (debitEl) debitEl.textContent = formatNumber(debit);
    if (creditEl) creditEl.textContent = formatNumber(credit);

    if (hint) {
        const balanced = Math.abs(debit - credit) < 0.000001 && debit > 0;
        hint.innerHTML = balanced
            ? '<span class="text-success"><i class="fas fa-check-circle"></i> Asiento balanceado</span>'
            : 'Las partidas deben estar balanceadas (débito = crédito).';
    }

    return { debit, credit };
}

function closeJournalEntryModal() {
    closeModal();
}

async function saveJournalEntry() {
    const date = new Date().toISOString().slice(0, 10);
    const description = (document.getElementById('journal-entry-description').value || '').trim();
    const reference = (document.getElementById('journal-entry-reference').value || '').trim();
    const kind = document.getElementById('journal-entry-kind').value;
    const isAdjustment = !!document.getElementById('journal-entry-adjustment')?.checked;

    if (!date || !description) {
        showAlert('La fecha y la descripción son obligatorias', 'warning');
        return;
    }

    const { debit, credit } = recalcJournalTotals();
    if (debit <= 0 || Math.abs(debit - credit) > 0.000001) {
        showAlert('El asiento debe tener débitos y créditos balanceados y mayores que cero', 'warning');
        return;
    }

    const lines = [];
    for (let i = 0; i < journalEntryDraftLines.length; i++) {
        const line = journalEntryDraftLines[i];
        const accountId = parseInt(line.accountId);
        if (!accountId) {
            showAlert(`Seleccione una cuenta en la línea ${i + 1}`, 'warning');
            return;
        }
        const lineDebit = parseFloat(line.debit) || 0;
        const lineCredit = parseFloat(line.credit) || 0;
        if ((lineDebit > 0) === (lineCredit > 0)) {
            showAlert(`La línea ${i + 1} debe tener débito o crédito (pero no ambos)`, 'warning');
            return;
        }
        lines.push({
            accountId,
            debit: lineDebit,
            credit: lineCredit,
            description: line.description ? line.description : undefined,
            costCenterId: line.costCenterId ? parseInt(line.costCenterId) : undefined
        });
    }

    try {
        const res = await apiRequest('/accounting/journal-entries', {
            method: 'POST',
            body: JSON.stringify({
                date,
                description,
                isAdjustment,
                reference: reference || undefined,
                kind,
                lines
            })
        });
        showAlert(`Asiento ${res?.formattedNumber || ''} guardado como borrador`, 'success');
        closeModal();
        await loadJournalEntries();
    } catch (error) {
        showAlert(error.message || 'Error al guardar el asiento', 'error');
    }
}

async function viewJournalEntry(id) {
    try {
        const entry = await apiRequest(`/accounting/journal-entries/${id}`);
        const lines = entry.lines || [];
        const totalDebit = lines.reduce((sum, l) => sum + (parseFloat(l.debit) || 0), 0);
        const totalCredit = lines.reduce((sum, l) => sum + (parseFloat(l.credit) || 0), 0);
        const number = entry.formattedNumber || `JE-${String(entry.entryNumber).padStart(8, '0')}`;

        document.getElementById('journal-detail-title').textContent = `${number} · ${entry.description}`;
        document.getElementById('journal-detail-content').innerHTML = `
            <div class="row mb-3">
                <div class="col-md-3"><strong>Fecha:</strong> ${formatDate(String(entry.date).slice(0, 10))}</div>
                <div class="col-md-3"><strong>Tipo:</strong> ${JOURNAL_KINDS[entry.kind] || escapeHtml(entry.kind)}</div>
                <div class="col-md-3"><strong>Estado:</strong>
                    <span class="status-badge ${entry.status === 'POSTED' ? 'status-active' : 'status-inactive'}">
                        ${JOURNAL_STATUS[entry.status] || escapeHtml(entry.status)}
                    </span>
                </div>
                <div class="col-md-3"><strong>Referencia:</strong> ${escapeHtml(entry.reference || '—')}</div>
            </div>
            <div class="row mb-3">
                <div class="col-md-4"><strong>Creado por:</strong> ${escapeHtml(entry.createdBy?.name || '—')}</div>
                <div class="col-md-4"><strong>Contabilizado por:</strong> ${escapeHtml(entry.postedBy?.name || '—')}</div>
                <div class="col-md-4"><strong>Período:</strong> ${escapeHtml(entry.period?.name || '—')}</div>
            </div>
            ${entry.reversal ? `<p class="text-muted">Tiene un reverso: <strong>JE-${String(entry.reversal.entryNumber).padStart(8, '0')}</strong></p>` : ''}
            ${entry.reversalOf ? `<p class="text-muted">Es el reverso de: <strong>JE-${String(entry.reversalOf.entryNumber).padStart(8, '0')}</strong></p>` : ''}
            <div class="table-responsive">
                <table class="table">
                    <thead>
                        <tr>
                            <th>Cuenta</th>
                            <th>Producto</th>
                            <th>Centro de costo</th>
                            <th>Descripción</th>
                            <th>Débito</th>
                            <th>Crédito</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${lines.map(l => `
                            <tr>
                                <td>${escapeHtml(l.account ? `${l.account.code} - ${l.account.name}` : '')}</td>
                                <td>${escapeHtml(l.product?.name || '—')}</td>
                                <td>${escapeHtml(l.costCenter?.name || '—')}</td>
                                <td>${escapeHtml(l.description || '')}</td>
                                <td>${formatNumber(parseFloat(l.debit) || 0)}</td>
                                <td>${formatNumber(parseFloat(l.credit) || 0)}</td>
                            </tr>`).join('')}
                    </tbody>
                    <tfoot>
                        <tr>
                            <td colspan="4" class="text-right"><strong>Totales:</strong></td>
                            <td><strong>${formatNumber(totalDebit)}</strong></td>
                            <td><strong>${formatNumber(totalCredit)}</strong></td>
                        </tr>
                    </tfoot>
                </table>
            </div>`;

        const actions = document.getElementById('journal-detail-actions');
        actions.innerHTML = '';
        if (entry.status === 'DRAFT') {
            actions.innerHTML = `
                <button class="btn btn-primary" onclick="postJournalEntry(${entry.id})">
                    <i class="fas fa-check"></i> Contabilizar
                </button>`;
        } else if (entry.status === 'POSTED' && entry.kind === 'GENERAL') {
            actions.innerHTML = `
                <button class="btn btn-danger" onclick="reverseJournalEntry(${entry.id})">
                    <i class="fas fa-undo"></i> Revertir
                </button>`;
        }

        showModal('journal-entry-detail-modal');
    } catch (error) {
        showAlert(error.message || 'Error al cargar el asiento', 'error');
    }
}

async function postJournalEntry(id) {
    try {
        await apiRequest(`/accounting/journal-entries/${id}/post`, { method: 'POST' });
        showAlert('Asiento contabilizado', 'success');
        closeModal();
        await loadJournalEntries();
    } catch (error) {
        showAlert(error.message || 'Error al contabilizar el asiento', 'error');
    }
}

async function reverseJournalEntry(id) {
    const ok = confirm('¿Revertir este asiento? Se creará automáticamente un asiento inverso.');
    if (!ok) return;

    try {
        const res = await apiRequest(`/accounting/journal-entries/${id}/reverse`, { method: 'POST' });
        showAlert(`Asiento revertido. Reverso: ${res?.formattedNumber || ''}`, 'success');
        closeModal();
        await loadJournalEntries();
    } catch (error) {
        showAlert(error.message || 'Error al revertir el asiento', 'error');
    }
}

// ---------- Balanza de comprobación ----------
async function loadTrialBalance() {
    try {
        const start = document.getElementById('trial-filter-start')?.value;
        const end = document.getElementById('trial-filter-end')?.value;

        const params = new URLSearchParams();
        if (start) params.set('startDate', start);
        if (end) params.set('endDate', end);
        const qs = params.toString();

        const tb = await apiRequest(`/accounting/trial-balance${qs ? `?${qs}` : ''}`);
        renderTrialBalance(tb);
    } catch (error) {
        showAlert(error.message || 'Error al calcular la balanza', 'error');
    }
}

function renderTrialBalance(tb) {
    const out = document.getElementById('trial-balance-output');
    if (!out) return;

    const allRows = tb.accounts || [];
    const rows = allRows.filter(r =>
        parseFloat(r.openingDebit) || parseFloat(r.openingCredit) ||
        parseFloat(r.periodDebits) || parseFloat(r.periodCredits) ||
        parseFloat(r.closingDebit) || parseFloat(r.closingCredit)
    );

    if (!rows.length) {
        out.innerHTML = '<p class="text-muted">No hay movimientos contabilizados en el rango indicado.</p>';
        return;
    }

    const totals = rows.reduce((acc, r) => {
        acc.od += parseFloat(r.openingDebit) || 0;
        acc.oc += parseFloat(r.openingCredit) || 0;
        acc.pd += parseFloat(r.periodDebits) || 0;
        acc.pc += parseFloat(r.periodCredits) || 0;
        acc.cd += parseFloat(r.closingDebit) || 0;
        acc.cc += parseFloat(r.closingCredit) || 0;
        return acc;
    }, { od: 0, oc: 0, pd: 0, pc: 0, cd: 0, cc: 0 });

    out.innerHTML = `
        <p class="text-muted">
            Período: <strong>${tb.startDate || 'Inicio'}</strong> → <strong>${tb.endDate}</strong>
            · Moneda funcional: <strong>${escapeHtml(tb.functionalCurrency)}</strong>
        </p>
        <div class="table-responsive">
            <table class="table table-adaptive">
                <thead>
                    <tr>
                        <th rowspan="2">Código</th>
                        <th rowspan="2">Cuenta</th>
                        <th colspan="2" class="text-center">Apertura</th>
                        <th colspan="2" class="text-center">Período</th>
                        <th colspan="2" class="text-center">Cierre</th>
                    </tr>
                    <tr>
                        <th class="text-center">Debe</th>
                        <th class="text-center">Haber</th>
                        <th class="text-center">Debe</th>
                        <th class="text-center">Haber</th>
                        <th class="text-center">Debe</th>
                        <th class="text-center">Haber</th>
                    </tr>
                </thead>
                <tbody>
                    ${rows.map(r => `
                        <tr>
                            <td><strong>${escapeHtml(r.account.code)}</strong></td>
                            <td>${escapeHtml(r.account.name)}</td>
                            <td class="text-right">${formatNumber(parseFloat(r.openingDebit) || 0)}</td>
                            <td class="text-right">${formatNumber(parseFloat(r.openingCredit) || 0)}</td>
                            <td class="text-right">${formatNumber(parseFloat(r.periodDebits) || 0)}</td>
                            <td class="text-right">${formatNumber(parseFloat(r.periodCredits) || 0)}</td>
                            <td class="text-right">${formatNumber(parseFloat(r.closingDebit) || 0)}</td>
                            <td class="text-right">${formatNumber(parseFloat(r.closingCredit) || 0)}</td>
                        </tr>`).join('')}
                </tbody>
                <tfoot>
                    <tr>
                        <td colspan="2" class="text-right"><strong>Totales</strong></td>
                        <td class="text-right"><strong>${formatNumber(totals.od)}</strong></td>
                        <td class="text-right"><strong>${formatNumber(totals.oc)}</strong></td>
                        <td class="text-right"><strong>${formatNumber(totals.pd)}</strong></td>
                        <td class="text-right"><strong>${formatNumber(totals.pc)}</strong></td>
                        <td class="text-right"><strong>${formatNumber(totals.cd)}</strong></td>
                        <td class="text-right"><strong>${formatNumber(totals.cc)}</strong></td>
                    </tr>
                </tfoot>
            </table>
        </div>`;
}

// ---------- Apertura contable ----------
async function loadInventoryOpeningPanel() {
    try {
        await refreshAccountingContext();
        renderAccountingStatus();

        const done = document.getElementById('accounting-opening-done');
        const wrap = document.getElementById('accounting-opening-form-wrap');

        if (isAccountingCutoverActive()) {
            if (done) {
                done.style.display = 'block';
                done.innerHTML = `<i class="fas fa-check-circle"></i> Apertura contable realizada el
                    <strong>${formatDate(accountingCompanyContext.accountingCutoverAt)}</strong>.
                    Los movimientos ya requieren cuenta de contrapartida.`;
            }
            if (wrap) wrap.style.display = 'none';
            return;
        }

        if (done) done.style.display = 'none';
        if (wrap) wrap.style.display = 'block';

        if (!accountingAccounts.length) {
            const res = await apiRequest('/accounting/accounts', { suppressErrorAlert: true });
            accountingAccounts = res?.data || [];
        }
        fillOpeningSelects();

        const dateEl = document.getElementById('opening-date');
        if (dateEl && !dateEl.value) dateEl.value = new Date().toISOString().slice(0, 10);

        const res = await apiRequest('/products?limit=1000', { suppressErrorAlert: true });
        openingProducts = (res?.data || [])
            .filter(p => p.isActive || (parseFloat(p.stock) || 0) > 0)
            .map(p => ({
                productId: p.id,
                name: `${p.code} - ${p.name}`,
                quantity: parseFloat(p.stock) || 0,
                unitCost: parseFloat(p.unitCost) || 0
            }));
        renderOpeningProducts();
    } catch (error) {
        showAlert(error.message || 'Error al cargar la apertura contable', 'error');
    }
}

function fillOpeningSelects() {
    const invSelect = document.getElementById('opening-inventory-account');
    const eqSelect = document.getElementById('opening-equity-account');
    const active = accountingAccounts.filter(a => a.isActive);

    if (invSelect) {
        invSelect.innerHTML = '<option value="">Seleccionar</option>' +
            active.filter(a => a.type === 'ASSET')
                .map(a => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`)
                .join('');
        if (accountingCompanyContext?.inventoryAccountId) {
            invSelect.value = String(accountingCompanyContext.inventoryAccountId);
        }
    }
    if (eqSelect) {
        eqSelect.innerHTML = '<option value="">Seleccionar</option>' +
            active.filter(a => a.type === 'EQUITY')
                .map(a => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name)}</option>`)
                .join('');
    }
}

function renderOpeningProducts() {
    const tbody = document.querySelector('#opening-products-table tbody');
    if (!tbody) return;

    if (!openingProducts.length) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center">No hay productos para inventariar</td></tr>';
        recalcOpeningTotal();
        return;
    }

    tbody.innerHTML = openingProducts.map((p, i) => `
        <tr>
            <td>${escapeHtml(p.name)}</td>
            <td>
                <input type="number" class="form-control" min="0" step="0.01" value="${p.quantity}"
                       oninput="updateOpeningProduct(${i}, 'quantity', this.value)">
            </td>
            <td>
                <input type="number" class="form-control" min="0" step="0.01" value="${p.unitCost}"
                       ${p.quantity > 0 ? '' : 'disabled'}
                       oninput="updateOpeningProduct(${i}, 'unitCost', this.value)">
            </td>
            <td class="opening-line-value">${formatNumber(p.quantity * p.unitCost)}</td>
        </tr>`).join('');

    recalcOpeningTotal();
}

function updateOpeningProduct(index, field, value) {
    if (index < 0 || index >= openingProducts.length) return;

    const amount = parseFloat(value) || 0;
    openingProducts[index][field] = amount;

    const tbody = document.querySelector('#opening-products-table tbody');
    const row = tbody?.children[index];
    if (row) {
        const inputs = row.querySelectorAll('input');
        if (field === 'quantity') {
            if (amount <= 0) {
                openingProducts[index].unitCost = 0;
                if (inputs[1]) {
                    inputs[1].value = '';
                    inputs[1].disabled = true;
                }
            } else if (inputs[1]) {
                inputs[1].disabled = false;
            }
        }
        const valueCell = row.querySelector('.opening-line-value');
        if (valueCell) {
            const line = openingProducts[index];
            valueCell.textContent = formatNumber(line.quantity * line.unitCost);
        }
    }

    recalcOpeningTotal();
}

function recalcOpeningTotal() {
    const total = openingProducts.reduce((sum, p) => sum + ((p.quantity || 0) * (p.unitCost || 0)), 0);
    const el = document.getElementById('opening-total');
    if (el) el.textContent = formatNumber(total);
    return total;
}

async function submitInventoryOpening() {
    const date = document.getElementById('opening-date').value;
    const description = (document.getElementById('opening-description').value || '').trim();
    const inventoryAccountId = parseInt(document.getElementById('opening-inventory-account').value);
    const openingEquityAccountId = parseInt(document.getElementById('opening-equity-account').value);

    if (!date || !description) {
        showAlert('La fecha y la descripción son obligatorias', 'warning');
        return;
    }
    if (!inventoryAccountId || !openingEquityAccountId) {
        showAlert('Seleccione la cuenta de inventario y la contrapartida de patrimonio', 'warning');
        return;
    }
    if (inventoryAccountId === openingEquityAccountId) {
        showAlert('La cuenta de inventario y la de patrimonio deben ser distintas', 'warning');
        return;
    }
    if (!openingProducts.length) {
        showAlert('No hay productos para inventariar', 'warning');
        return;
    }

    const total = recalcOpeningTotal();
    if (total <= 0) {
        showAlert('El valor total del inventario de apertura debe ser mayor que cero', 'warning');
        return;
    }

    const ok = confirm(`¿Realizar la apertura contable con un inventario valorado en ${formatNumber(total)}? Esta acción no se puede deshacer.`);
    if (!ok) return;

    try {
        await apiRequest('/accounting/inventory-opening', {
            method: 'POST',
            body: JSON.stringify({
                date,
                description,
                inventoryAccountId,
                openingEquityAccountId,
                items: openingProducts.map(p => ({
                    productId: p.productId,
                    countedQuantity: p.quantity,
                    unitCost: p.unitCost
                }))
            })
        });
        showAlert('Apertura contable realizada con éxito', 'success');
        await refreshAccountingContext();
        renderAccountingStatus();
        await loadInventoryOpeningPanel();
    } catch (error) {
        showAlert(error.message || 'Error al realizar la apertura', 'error');
    }
}

// ---------- Contrapartida en movimientos (usado desde movements.js) ----------
async function prepareCounterpartForMovement(movementType) {
    const section = document.getElementById('movement-counterpart-section');
    const select = document.getElementById('movement-counterpart');
    const hint = document.getElementById('movement-counterpart-hint');
    if (!section || !select) return;

    try {
        if (!accountingCompanyContext) await refreshAccountingContext();

        if (!isAccountingCutoverActive()) {
            section.style.display = 'none';
            return;
        }

        const res = await apiRequest('/accounting/accounts', { suppressErrorAlert: true });
        const accounts = (res?.data || []).filter(a => a.isActive);
        const allowed = accounts.filter(a =>
            movementType === 'SALIDA' ? a.type === 'EXPENSE' : a.type !== 'EXPENSE'
        );

        section.style.display = 'block';
        select.innerHTML = '<option value="">Seleccionar cuenta</option>';
        allowed.forEach(a => {
            const opt = document.createElement('option');
            opt.value = a.id;
            opt.textContent = `${a.code} - ${a.name}`;
            select.appendChild(opt);
        });

        if (hint) {
            hint.textContent = movementType === 'SALIDA'
                ? 'Las salidas se imputan a una cuenta de gasto.'
                : 'Las entradas no pueden imputarse a cuentas de gasto.';
        }

        if (!allowed.length) {
            showAlert('No hay cuentas contables disponibles para la contrapartida. Regístrelas en Contabilidad > Cuentas.', 'warning');
        }
    } catch (error) {
        section.style.display = 'none';
        console.error('Error preparing counterpart select:', error);
    }
}

// ---------- Inicialización y exports ----------
document.addEventListener('DOMContentLoaded', () => {
    const typeSelect = document.getElementById('account-type');
    if (typeSelect) {
        typeSelect.addEventListener('change', () => populateAccountParentOptions());
    }
});

window.loadAccounting = loadAccounting;
window.switchAccountingTab = switchAccountingTab;
window.openAccountModal = openAccountModal;
window.editAccount = editAccount;
window.closeAccountModal = closeAccountModal;
window.saveAccount = saveAccount;
window.toggleAccountActive = toggleAccountActive;
window.renderAccountsTable = renderAccountsTable;
window.openPeriodModal = openPeriodModal;
window.savePeriod = savePeriod;
window.closeAccountingPeriod = closeAccountingPeriod;
window.loadJournalEntries = loadJournalEntries;
window.openJournalEntryModal = openJournalEntryModal;
window.closeJournalEntryModal = closeJournalEntryModal;
window.saveJournalEntry = saveJournalEntry;
window.addJournalLine = addJournalLine;
window.removeJournalLine = removeJournalLine;
window.updateJournalLine = updateJournalLine;
window.viewJournalEntry = viewJournalEntry;
window.postJournalEntry = postJournalEntry;
window.reverseJournalEntry = reverseJournalEntry;
window.loadTrialBalance = loadTrialBalance;
window.submitInventoryOpening = submitInventoryOpening;
window.updateOpeningProduct = updateOpeningProduct;
window.refreshAccountingContext = refreshAccountingContext;
window.isAccountingCutoverActive = isAccountingCutoverActive;
window.prepareCounterpartForMovement = prepareCounterpartForMovement;
