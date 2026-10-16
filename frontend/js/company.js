function resolveCompanyLogoUrl(logoPath) {
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
let selectedLogoFile = null;
let currentCompanyId = 1;

// Cargar información de la empresa
async function loadCompanyInfo() {
    try {
        const company = await apiRequest('/company');
        currentCompanyId = company?.id || 1;
        
        document.getElementById('company-name').value = company.name || '';
        document.getElementById('company-tax-id').value = company.taxId || '';
        document.getElementById('company-address').value = company.address || '';
        document.getElementById('company-phone').value = company.phone || '';
        document.getElementById('company-email').value = company.email || '';
        document.getElementById('company-website').value = company.website || '';
        
        const logoImg = document.getElementById('company-logo');
        const noLogoEl = document.getElementById('no-logo');
        const logoUrl = resolveCompanyLogoUrl(company.logo);

        if (logoUrl) {
            const cacheKey = company.updatedAt ? new Date(company.updatedAt).getTime() : Date.now();
            const finalUrl = `${logoUrl}${logoUrl.includes('?') ? '&' : '?'}v=${cacheKey}`;
            logoImg.onerror = function () {
                logoImg.onerror = null;
                logoImg.style.display = 'none';
                if (noLogoEl) noLogoEl.style.display = 'block';
            };
            logoImg.src = finalUrl;
            logoImg.style.display = 'block';
            if (noLogoEl) noLogoEl.style.display = 'none';
        } else {
            logoImg.style.display = 'none';
            if (noLogoEl) noLogoEl.style.display = 'block';
        }
        
    } catch (error) {
        console.error('Error loading company info:', error);
        showAlert('Error al cargar la información de la empresa', 'error');
    }
}

// Guardar información de la empresa
async function saveCompanyInfo() {
    const companyId = currentCompanyId || 1;
    
    const companyData = {
        name: document.getElementById('company-name').value || undefined,
        taxId: document.getElementById('company-tax-id').value || undefined,
        address: document.getElementById('company-address').value || undefined,
        phone: document.getElementById('company-phone').value || undefined,
        email: document.getElementById('company-email').value || undefined,
        website: document.getElementById('company-website').value || undefined
    };
    
    try {
        await apiRequest(`/company/${companyId}`, {
            method: 'PUT',
            body: JSON.stringify(companyData)
        });
        
        showAlert('Información de la empresa actualizada exitosamente', 'success');
        
    } catch (error) {
        showAlert(error.message || 'Error al guardar la información de la empresa', 'error');
    }
}

// Subir logo de la empresa
async function uploadLogo() {
    const companyId = currentCompanyId || 1;
    const fileInput = document.getElementById('logo-file');

    if (!fileInput) {
        console.error('uploadLogo: elemento #logo-file no encontrado');
        showAlert('Elemento de archivo no encontrado', 'error');
        return;
    }

    const file = (fileInput.files && fileInput.files[0]) ? fileInput.files[0] : selectedLogoFile;

    if (!file) {
        showAlert('Por favor, seleccione un archivo', 'warning');
        return;
    }

    // Validar tipo de archivo
    const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
        showAlert('Solo se permiten archivos JPG, PNG o SVG', 'error');
        return;
    }

    // Validar tamaño (5MB)
    if (file.size > 5 * 1024 * 1024) {
        showAlert('El archivo no debe superar los 5MB', 'error');
        return;
    }

    const formData = new FormData();
    formData.append('logo', file, file.name || 'logo.png');

    try {
        // Validaciones básicas de entorno
        if (typeof API_BASE_URL === 'undefined') {
            throw new Error('API_BASE_URL no está definido en la aplicación');
        }

        const token = (typeof getToken === 'function') ? getToken() : null;
        const headers = {};
        if (token) headers['Authorization'] = `Bearer ${token}`;

        console.log('uploadLogo: enviando a', `${API_BASE_URL}/company/${companyId}/logo`, 'headers', !!token);

        let response = await fetch(`${API_BASE_URL}/company/${companyId}/logo`, {
            method: 'PUT',
            headers,
            body: formData
        });

        // Si el servidor rechaza PUT (405) o devuelve error, reintentar con POST
        if (!response.ok) {
            if (response.status === 405) {
                console.warn('PUT no soportado, reintentando con POST');
                response = await fetch(`${API_BASE_URL}/company/${companyId}/logo`, {
                    method: 'POST',
                    headers,
                    body: formData
                });
            }
        }

        if (!response.ok) {
            // Intentar leer cuerpo con detalle del error
            let errDetails = '';
            try {
                const errJson = await response.json();
                errDetails = errJson.message || errJson.error || JSON.stringify(errJson);
            } catch (e) {
                errDetails = await response.text();
            }
            throw new Error(`Error ${response.status}: ${response.statusText} - ${errDetails}`);
        }

        const result = await response.json();
        console.log('uploadLogo: respuesta', result);

        const logoPath = result.logo || result.path || result.filename || null;
        if (!logoPath) {
            console.warn('uploadLogo: la API no devolvió una URL de logo', result);
        }

        showAlert('Logo actualizado exitosamente', 'success');
        await loadCompanyInfo();

        // Limpiar input de archivo
        fileInput.value = '';
        selectedLogoFile = null;

    } catch (error) {
        console.error('Error uploading logo:', error);
        showAlert(error.message || 'Error al subir el logo', 'error');
    }
}

// Cargar monedas y tasas
async function loadCurrencySettings() {
    try {
        const response = await apiRequest('/currencies');
        const list = response?.data || [];

        const select = document.getElementById('currency-code');
        const rateInput = document.getElementById('currency-rate');
        const effectiveEl = document.getElementById('currency-effective');

        if (!select || !rateInput) return;

        select.innerHTML = '';
        list.forEach(c => {
            const option = document.createElement('option');
            option.value = c.code;
            option.textContent = `${c.code} - ${c.name}`;
            if (c.isDefault) option.selected = true;
            select.appendChild(option);
        });

        async function fetchExternalCurrencyRate(code) {
            try {
                const response = await apiRequest(`/currencies/external/${code}`, {
                    method: 'POST',
                    suppressErrorAlert: true,
                });
                return response?.data || null;
            } catch (error) {
                console.warn('No se pudo obtener la tasa externa:', error);
                return null;
            }
        }

        async function updateRateDisplay(code) {
            const entry = list.find(c => c.code === code);
            const rate = entry?.rate || (code === 'USD' ? 1 : 1);
            const displayRate = rate > 0 ? (1 / rate) : 0;
            rateInput.value = displayRate ? displayRate.toFixed(4) : '';

            if (effectiveEl) {
                if (entry?.effectiveFrom) {
                    effectiveEl.textContent = `Vigente desde: ${new Date(entry.effectiveFrom).toLocaleString()}`;
                } else {
                    effectiveEl.textContent = '';
                }
            }
        }

        async function refreshCupRate() {
            const cupEntry = list.find(c => c.code === 'CUP');
            if (!cupEntry) return;

            const external = await fetchExternalCurrencyRate('CUP');
            if (external?.rate) {
                cupEntry.rate = external.rate;
                cupEntry.effectiveFrom = new Date();
                if (select.value === 'CUP') {
                    const externalDisplay = external.rate > 0 ? (1 / external.rate) : 0;
                    rateInput.value = externalDisplay ? externalDisplay.toFixed(4) : rateInput.value;
                    if (effectiveEl) {
                        effectiveEl.textContent = `Actualizado desde El Toque: ${externalDisplay ? externalDisplay.toFixed(2) : ''}`;
                    }
                }
            } else {
                showAlert('No se pudo actualizar automáticamente la tasa CUP desde El Toque. Verifique conexión y actualice manualmente.', 'warning');
                if (select.value === 'CUP' && effectiveEl) {
                    effectiveEl.textContent = 'No fue posible actualizar desde El Toque';
                }
            }
        }

        await refreshCupRate();
        await updateRateDisplay(select.value);
        select.onchange = async () => await updateRateDisplay(select.value);
    } catch (error) {
        console.error('Error loading currencies:', error);
        showAlert('Error al cargar monedas', 'error');
    }
}

async function saveCurrencyRate() {
    const select = document.getElementById('currency-code');
    const rateInput = document.getElementById('currency-rate');

    if (!select || !rateInput) return;

    const code = select.value;
    const inputRate = parseFloat(rateInput.value);

    if (!inputRate || inputRate <= 0) {
        showAlert('La tasa debe ser mayor que 0', 'warning');
        return;
    }

    // Convert from "1 USD = X currency" to "USD per 1 currency"
    const normalizedRate = code === 'USD' ? 1 : (1 / inputRate);

    try {
        await apiRequest(`/currencies/${code}`, {
            method: 'PATCH',
            body: JSON.stringify({ rate: normalizedRate })
        });

        showAlert('Tasa actualizada exitosamente', 'success');
        await loadCurrencySettings();
    } catch (error) {
        console.error('Error saving currency rate:', error);
        showAlert(error.message || 'Error al actualizar la tasa', 'error');
    }
}

async function createCurrency() {
    const codeInput = document.getElementById('new-currency-code');
    const nameInput = document.getElementById('new-currency-name');
    const rateInput = document.getElementById('new-currency-rate');
    const defaultInput = document.getElementById('new-currency-default');

    if (!codeInput || !nameInput || !rateInput || !defaultInput) return;

    const code = (codeInput.value || '').trim().toUpperCase();
    const name = (nameInput.value || '').trim();
    const rate = parseFloat(rateInput.value);
    const isDefault = !!defaultInput.checked;

    if (!code || !name) {
        showAlert('Código y nombre son obligatorios', 'warning');
        return;
    }
    if (!rate || rate <= 0) {
        showAlert('La tasa debe ser mayor que 0', 'warning');
        return;
    }

    try {
        await apiRequest('/currencies', {
            method: 'POST',
            body: JSON.stringify({ code, name, rate, isDefault })
        });
        showAlert('Moneda creada exitosamente', 'success');
        codeInput.value = '';
        nameInput.value = '';
        rateInput.value = '';
        defaultInput.checked = false;
        await loadCurrencySettings();
    } catch (error) {
        showAlert(error.message || 'Error al crear moneda', 'error');
    }
}

async function loadMaintenanceConfig() {
    try {
        const cfg = await apiRequest('/maintenance/config');
        const backupDirInput = document.getElementById('maintenance-backup-dir');
        const helpEl = document.getElementById('maintenance-backup-dir-help');
        if (backupDirInput && cfg?.defaultBackupDir && !backupDirInput.value) {
            backupDirInput.value = cfg.defaultBackupDir;
        }
        if (helpEl) {
            const autoText = cfg?.autoBackupEnabled
                ? `Salva automatica activa cada ${cfg?.autoBackupIntervalHours || 24} horas`
                : 'Salva automatica desactivada';
            helpEl.textContent = `Ruta por defecto en servidor: ${cfg?.defaultBackupDir || '-'} | ${autoText}`;
        }
    } catch (error) {
        console.warn('No se pudo cargar configuracion de mantenimiento', error);
    }
}

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('company-form') && isAdmin()) {
        loadCompanyInfo();
        loadCurrencySettings();
        loadMaintenanceConfig();
        
        // Formulario de informacion de la empresa
        document.getElementById('company-form').addEventListener('submit', (e) => {
            e.preventDefault();
            saveCompanyInfo();
        });
        
        // Formulario de logo
        document.getElementById('logo-form').addEventListener('submit', (e) => {
            e.preventDefault();
            uploadLogo();
        });
        const logoFileInput = document.getElementById('logo-file');
        if (logoFileInput) {
            logoFileInput.addEventListener('change', () => {
                selectedLogoFile = (logoFileInput.files && logoFileInput.files[0]) ? logoFileInput.files[0] : null;
            });
        }

        const currencyForm = document.getElementById('currency-form');
        if (currencyForm) {
            currencyForm.addEventListener('submit', (e) => {
                e.preventDefault();
                saveCurrencyRate();
            });
        }

        const currencyCreateForm = document.getElementById('currency-create-form');
        if (currencyCreateForm) {
            currencyCreateForm.addEventListener('submit', (e) => {
                e.preventDefault();
                createCurrency();
            });
        }

        const backupBtn = document.getElementById('maintenance-backup-btn');
        if (backupBtn) {
            backupBtn.addEventListener('click', async () => {
                const backupDirInput = document.getElementById('maintenance-backup-dir');
                const outputDir = (backupDirInput?.value || '').trim();
                try {
                    backupBtn.disabled = true;
                    const res = await apiRequest('/maintenance/backup', {
                        method: 'POST',
                        body: JSON.stringify({ outputDir: outputDir || undefined })
                    });
                    showAlert(`Backup creado exitosamente${res?.path ? `: ${res.path}` : ''}`, 'success');
                } catch (error) {
                    showAlert(error.message || 'Error al crear backup', 'error');
                } finally {
                    backupBtn.disabled = false;
                }
            });
        }

        const restoreBtn = document.getElementById('maintenance-restore-btn');
        if (restoreBtn) {
            restoreBtn.addEventListener('click', async () => {
                const restoreDirInput = document.getElementById('maintenance-restore-dir');
                const backupDir = (restoreDirInput?.value || '').trim();
                if (!backupDir) {
                    showAlert('Indique la ruta de la salva a restaurar', 'warning');
                    return;
                }
                const ok = confirm('Esto reemplazara la base de datos y archivos actuales por los de la salva. Continuar?');
                if (!ok) return;
                try {
                    restoreBtn.disabled = true;
                    const res = await apiRequest('/maintenance/restore', {
                        method: 'POST',
                        body: JSON.stringify({ backupDir })
                    });
                    showAlert(`Salva restaurada correctamente${res?.path ? `: ${res.path}` : ''}`, 'success');
                } catch (error) {
                    showAlert(error.message || 'Error al restaurar salva', 'error');
                } finally {
                    restoreBtn.disabled = false;
                }
            });
        }

        const resetBtn = document.getElementById('maintenance-reset-btn');
        if (resetBtn) {
            resetBtn.addEventListener('click', async () => {
                const ok = confirm('ATENCION: Esto eliminara todos los datos actuales.\n\nAsegure que ya hizo una salva previa.');
                if (!ok) return;
                const confirmText = prompt('Escriba RESET para confirmar:');
                if (confirmText !== 'RESET') {
                    showAlert('Confirmacion incorrecta. Operacion cancelada.', 'warning');
                    return;
                }
                try {
                    resetBtn.disabled = true;
                    const res = await apiRequest('/maintenance/reset', {
                        method: 'POST',
                        body: JSON.stringify({ confirm: 'RESET', ackBackupWarning: true })
                    });
                    if (res?.ok === false) {
                        throw new Error(res.message || 'Confirmacion requerida');
                    }
                    showAlert('Datos eliminados y sistema restablecido. Se recomienda reiniciar backend.', 'success');
                } catch (error) {
                    showAlert(error.message || 'Error al restablecer', 'error');
                } finally {
                    resetBtn.disabled = false;
                }
            });
        }
    }
});
