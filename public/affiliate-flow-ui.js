(function () {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  let activeWatcher = null;
  let lastCheckedText = '';

  async function submitAffiliateLink(interventionId, rawLink) {
    const text = (rawLink || '').trim();
    if (!text) return false;

    const isAffiliate = /meli\.la\/[a-zA-Z0-9_-]+/i.test(text) ||
                        /(?:s\.shopee\.com\.br|shope\.ee)\/[a-zA-Z0-9_-]+/i.test(text) ||
                        /(?:amzn\.to\/[a-zA-Z0-9_-]+|amazon\.com\.br\/.*tag=)/i.test(text);

    if (!isAffiliate) return false;

    const feedback = document.querySelector(`[data-affiliate-feedback="${interventionId}"]`);
    if (feedback) feedback.textContent = '⚡ Link detectado! Validando e associando ao produto...';

    try {
      const res = await fetch('/api/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'SUBMIT_AFFILIATE_LINK',
          interventionId,
          rawLink: text
        })
      });
      const result = await res.json();
      if (res.ok && result.success && result.status === 'AFFILIATE_LINK_READY') {
        if (activeWatcher) {
          clearInterval(activeWatcher);
          activeWatcher = null;
        }
        if (feedback) feedback.textContent = '✅ Link validado e salvo com sucesso!';
        if (window.loadDashboard) window.loadDashboard();
        return true;
      } else if (feedback && result.reason) {
        feedback.textContent = `Atenção: ${result.reason}`;
      }
    } catch (e) {
      if (feedback) feedback.textContent = `Erro ao salvar: ${e.message}`;
    }
    return false;
  }

  function copySynchronously(text) {
    if (!text) return false;
    let ok = false;
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ok = document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (_) {}
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
    return ok;
  }

  async function checkClipboard(interventionId) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) return;
      const text = (await navigator.clipboard.readText() || '').trim();
      if (!text || text === lastCheckedText) return;
      lastCheckedText = text;
      await submitAffiliateLink(interventionId, text);
    } catch (_) {}
  }

  function startClipboardWatcher(interventionId) {
    if (activeWatcher) clearInterval(activeWatcher);
    const trigger = () => checkClipboard(interventionId);
    window.addEventListener('focus', trigger);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') trigger();
    });
    activeWatcher = setInterval(trigger, 1000);
  }

  window.renderAffiliateLinkCard = function (item) {
    const meta = item.metadata || {};
    const ready = meta.step === 'AFFILIATE_LINK_READY' && meta.affiliateLinkStatus === 'VERIFIED' &&
      !!meta.affiliateUrl && !!meta.savedAt;
    const id = escape(item.id);
    const price = Number(meta.price);
    const scoreVal = meta.score ?? 'Não informado';
    const prodUrl = escape(meta.productUrl || '');

    return `<div class="intervention-banner" id="interventionCard-${id}" style="margin-bottom:14px; border-color:rgba(59,130,246,0.5); background:linear-gradient(180deg, rgba(14,20,32,0.95) 0%, rgba(10,15,26,0.98) 100%);">
      <div class="intervention-header">
        <strong style="color:#60a5fa; font-size:0.95rem;">🛒 Produto selecionado</strong>
        <span style="font-size:0.75rem; color:var(--text-dim);">${item.time || ''}</span>
      </div>
      <div style="font-size:1rem; font-weight:800; color:#fff; margin-top:4px;">${escape(meta.productTitle || item.title)}</div>
      <div style="font-size:0.8rem; color:#cbd5e1; margin-top:4px;">
        <span style="text-transform:uppercase; font-weight:700; color:#f59e0b;">${escape(item.marketplace || 'Mercado Livre')}</span> • 
        Preço: <strong style="color:#34d399; font-family:'JetBrains Mono';">${Number.isFinite(price) && meta.price != null ? escape(price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) : 'Não informado'}</strong> • 
        Score: <strong style="color:#60a5fa;">${escape(scoreVal)}</strong>
      </div>

      ${ready ? `
        <div style="margin-top:12px; padding:10px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.3); border-radius:8px;">
          <p style="color:#34d399; font-weight:700; font-size:0.85rem; margin:0 0 8px 0;">✅ Link de afiliado validado e salvo!</p>
          <div style="font-size:0.75rem; color:#94a3b8; font-family:'JetBrains Mono'; word-break:break-all; margin-bottom:10px;">${escape(meta.affiliateUrl)}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="topbar-btn" style="opacity:0.9; cursor:default; background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.2); color:#fff; font-weight:800; font-size:0.82rem; padding:8px 14px;" disabled>🎬 GERAR CRIATIVO</button>
            <button type="button" class="topbar-btn topbar-btn-primary" style="opacity:0.9; cursor:default; background:#2563eb; border-color:#3b82f6; color:#fff; font-weight:800; font-size:0.82rem; padding:8px 14px;" disabled>🚀 PUBLICAR AGORA</button>
          </div>
        </div>
      ` : `
        <div style="margin-top:12px;">
          <div style="display:flex; gap:8px; margin-bottom:8px;">
            <button type="button" class="topbar-btn topbar-btn-primary" data-affiliate-open="${id}" data-product-url="${prodUrl}" style="flex:1; justify-content:center; padding:12px; font-size:0.9rem; font-weight:800; background:#2563eb; border-color:#3b82f6; color:#fff; box-shadow:0 0 16px rgba(37,99,235,0.4); cursor:pointer;">
              🔗 GERAR LINK
            </button>
            <button type="button" class="topbar-btn" data-copy-prod-url="${prodUrl}" title="Copiar URL original do produto" style="background:rgba(255,255,255,0.08); border-color:rgba(255,255,255,0.2); color:#e2e8f0; font-weight:700; padding:0 14px; font-size:0.8rem; cursor:pointer;">
              📋 Copiar URL
            </button>
          </div>

          <div style="font-size:0.75rem; color:#94a3b8; line-height:1.4; background:rgba(0,0,0,0.3); padding:8px 10px; border-radius:6px; border-left:3px solid #3b82f6;">
            💡 <strong>Como funciona:</strong> Ao clicar em <strong>GERAR LINK</strong>, a URL do produto é copiada para você e o gerador oficial é aberto. Basta dar <strong>Ctrl+V</strong> no campo e clicar em <em>Gerar</em>. Ao clicar em <strong>Copiar</strong> no Mercado Livre, o ACHAki detecta imediatamente!
          </div>

          <div style="margin-top:10px;">
            <label style="font-size:0.7rem; color:var(--text-dim); display:block; margin-bottom:2px;">URL original do produto selecionado (toque para copiar):</label>
            <input type="text" readonly value="${prodUrl}" onclick="this.select(); copySynchronously(this.value); const fb = document.querySelector('[data-affiliate-feedback=\'${id}\']'); if (fb) fb.textContent = '📋 URL copiada com sucesso!';" title="Toque para copiar a URL do produto" style="width:100%; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px 10px; font-size:0.75rem; color:#94a3b8; font-family:'JetBrains Mono'; cursor:pointer;" aria-label="URL original do produto">
          </div>

          <div style="margin-top:10px; padding-top:8px; border-top:1px dashed rgba(255,255,255,0.1);">
            <label style="font-size:0.7rem; color:var(--text-dim); display:block; margin-bottom:4px;">Ou cole o link gerado aqui se preferir:</label>
            <div style="display:flex; gap:6px;">
              <input type="text" data-manual-link-input="${id}" placeholder="Ex: https://meli.la/..." style="flex:1; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.15); border-radius:6px; padding:6px 10px; font-size:0.75rem; color:#fff; font-family:'JetBrains Mono';">
              <button type="button" class="topbar-btn" data-manual-link-submit="${id}" style="background:#059669; border-color:#10b981; color:#fff; font-weight:700; font-size:0.75rem; padding:6px 12px; cursor:pointer;">
                Salvar
              </button>
            </div>
          </div>

          ${meta.interventionRequired ? `<p style="color:#fbbf24; font-size:0.75rem; margin-top:6px;">⚠️ ${escape(meta.interventionRequired)}: conclua a verificação solicitada pelo marketplace nessa janela.</p>` : ''}
          ${meta.captureStatus === 'TIMED_OUT' ? '<p style="color:#f87171; font-size:0.75rem; margin-top:6px;">Link ainda não confirmado. Clique em GERAR LINK para retomar a captura.</p>' : ''}
        </div>
      `}
      ${!ready && ['ERROR', 'CLOSED'].includes(meta.captureStatus) ? '<p style="color:#f87171; font-size:0.75rem; margin-top:6px;">A captura foi interrompida. Clique em GERAR LINK para tentar novamente.</p>' : ''}
      <div data-affiliate-feedback="${id}" role="status" style="font-size:0.78rem; color:#38bdf8; margin-top:8px; font-weight:600;"></div>
    </div>`;
  };

  document.addEventListener('click', async event => {
    // 1. Botão de copiar URL original do produto
    const copyProdBtn = event.target.closest('[data-copy-prod-url]');
    if (copyProdBtn) {
      const url = copyProdBtn.dataset.copyProdUrl;
      if (url) {
        copySynchronously(url);
        const prevText = copyProdBtn.textContent;
        copyProdBtn.textContent = '✅ Copiado!';
        setTimeout(() => { copyProdBtn.textContent = prevText; }, 2000);
      }
      return;
    }

    // 2. Botão manual de submissão do link
    const submitManualBtn = event.target.closest('[data-manual-link-submit]');
    if (submitManualBtn) {
      const id = submitManualBtn.dataset.manualLinkSubmit;
      const input = document.querySelector(`[data-manual-link-input="${id}"]`);
      if (input && input.value) {
        submitManualBtn.disabled = true;
        await submitAffiliateLink(id, input.value);
        submitManualBtn.disabled = false;
      }
      return;
    }

    // 3. Botão principal GERAR LINK
    const button = event.target.closest('[data-affiliate-open]');
    if (!button || button.disabled) return;
    const id = button.dataset.affiliateOpen;
    const prodUrl = button.dataset.productUrl;
    const feedback = button.parentElement.parentElement.querySelector(`[data-affiliate-feedback="${id}"]`) || document.querySelector(`[data-affiliate-feedback="${id}"]`);

    // Cópia síncrona imediata no gesto do usuário (antes do fetch)
    if (prodUrl) {
      copySynchronously(prodUrl);
    }

    button.disabled = true;

    try {
      if (feedback) feedback.textContent = 'Preparando link do produto e gerador oficial...';

      const response = await fetch('/api/controls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'OPEN_AFFILIATE_GENERATOR', interventionId: id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.reason || 'Não foi possível abrir o gerador.');

      // Se a API retornou productUrl mais atualizada, copia também
      if (data.productUrl) {
        copySynchronously(data.productUrl);
      }

      // Abre a aba do gerador oficial para o operador
      if (data.generatorUrl) {
        window.open(data.generatorUrl, '_blank', 'noopener,noreferrer');
      }

      if (feedback) {
        feedback.innerHTML = '📋 <strong>URL do produto copiada!</strong> Cole no gerador (Ctrl+V) e clique em <em>Gerar</em>.<br>Ao clicar em <strong>Copiar</strong> no Mercado Livre, o ACHAki detecta na hora!';
      }

      // Inicia a escuta ativa do clipboard
      startClipboardWatcher(id);
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
