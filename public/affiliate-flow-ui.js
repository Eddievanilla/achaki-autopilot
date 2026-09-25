(function () {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  let activeWatcher = null;

  async function checkAndSubmitClipboard(interventionId) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.readText) return;
      const text = (await navigator.clipboard.readText() || '').trim();
      if (!text) return;

      const isAffiliate = /meli\.la\/[a-zA-Z0-9_-]+/i.test(text) ||
                          /(?:s\.shopee\.com\.br|shope\.ee)\/[a-zA-Z0-9_-]+/i.test(text) ||
                          /(?:amzn\.to\/[a-zA-Z0-9_-]+|amazon\.com\.br\/.*tag=)/i.test(text);

      if (isAffiliate) {
        const feedback = document.querySelector(`[data-affiliate-feedback="${interventionId}"]`);
        if (feedback) feedback.textContent = '⚡ Link detectado na área de transferência! Validando e salvando...';

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
        } else if (feedback && result.reason) {
          feedback.textContent = `Atenção: ${result.reason}`;
        }
      }
    } catch (_) {}
  }

  function startClipboardWatcher(interventionId) {
    if (activeWatcher) clearInterval(activeWatcher);
    window.addEventListener('focus', () => checkAndSubmitClipboard(interventionId));
    activeWatcher = setInterval(() => checkAndSubmitClipboard(interventionId), 1500);
  }

  window.renderAffiliateLinkCard = function (item) {
    const meta = item.metadata || {};
    const ready = meta.step === 'AFFILIATE_LINK_READY' && meta.affiliateLinkStatus === 'VERIFIED' &&
      !!meta.affiliateUrl && !!meta.savedAt;
    const id = escape(item.id);
    const price = Number(meta.price);
    const scoreVal = meta.score ?? 'Não informado';

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
          <button type="button" class="topbar-btn topbar-btn-primary" data-affiliate-open="${id}" style="width:100%; justify-content:center; padding:12px; font-size:0.9rem; font-weight:800; background:#2563eb; border-color:#3b82f6; color:#fff; box-shadow:0 0 16px rgba(37,99,235,0.4); cursor:pointer;">
            🔗 GERAR LINK
          </button>
          <div style="font-size:0.75rem; color:#94a3b8; margin-top:8px; line-height:1.4;">
            ${meta.productUrlPreparedAt 
              ? 'URL preenchida. Clique em Gerar/Copiar no marketplace; o ACHAki detecta, valida e salva o link automaticamente.' 
              : 'O ACHAki abre o gerador oficial do marketplace. Ao clicar em copiar o link, o ACHAki detecta imediatamente.'}
          </div>
          <div style="margin-top:8px;">
            <label style="font-size:0.7rem; color:var(--text-dim); display:block; margin-bottom:2px;">URL original do produto selecionado:</label>
            <input type="text" readonly value="${escape(meta.productUrl)}" style="width:100%; background:rgba(0,0,0,0.4); border:1px solid rgba(255,255,255,0.1); border-radius:6px; padding:6px 10px; font-size:0.75rem; color:#94a3b8; font-family:'JetBrains Mono';" aria-label="URL original do produto">
          </div>
          ${meta.interventionRequired ? `<p style="color:#fbbf24; font-size:0.75rem; margin-top:6px;">⚠️ ${escape(meta.interventionRequired)}: conclua a verificação solicitada pelo marketplace nessa janela.</p>` : ''}
          ${meta.captureStatus === 'TIMED_OUT' ? '<p style="color:#f87171; font-size:0.75rem; margin-top:6px;">Link ainda não confirmado. Clique em GERAR LINK para retomar a captura.</p>' : ''}
        </div>
      `}
      ${!ready && ['ERROR', 'CLOSED'].includes(meta.captureStatus) ? '<p style="color:#f87171; font-size:0.75rem; margin-top:6px;">A captura foi interrompida. Clique em GERAR LINK para tentar novamente.</p>' : ''}
      <div data-affiliate-feedback="${id}" role="status" style="font-size:0.75rem; color:#38bdf8; margin-top:6px; font-weight:600;"></div>
    </div>`;
  };

  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-affiliate-open]');
    if (!button || button.disabled) return;
    const id = button.dataset.affiliateOpen;
    const feedback = button.parentElement.querySelector(`[data-affiliate-feedback="${id}"]`) || button.parentElement.querySelector('[data-affiliate-feedback]');
    button.disabled = true;
    try {
      if (feedback) feedback.textContent = 'Abrindo gerador oficial do marketplace...';
      const response = await fetch('/api/controls', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'OPEN_AFFILIATE_GENERATOR', interventionId: id }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || data.reason || 'Não foi possível abrir o gerador.');
      
      // Abre o gerador na nova aba do navegador para o operador
      if (data.generatorUrl) {
        window.open(data.generatorUrl, '_blank', 'noopener,noreferrer');
      }

      if (feedback) feedback.textContent = 'Gerador aberto! Ao copiar o link gerado, o ACHAki detecta e salva automaticamente.';
      
      // Inicia a detecção automática pelo Clipboard
      startClipboardWatcher(id);
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
})();
