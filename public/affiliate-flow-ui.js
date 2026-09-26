(function () {
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  let activeWatcher = null;
  let lastCheckedText = '';

  async function submitAffiliateLink(interventionId, rawLink) {
    let text = (rawLink || '').trim();
    if (!text) return false;

    // Extrai URL limpa caso o usuário copie junto com texto de compartilhamento
    const urlMatch = text.match(/(https?:\/\/[^\s]+)/i);
    if (urlMatch) text = urlMatch[1];

    const isAffiliate = /meli\.la\/[a-zA-Z0-9_-]+/i.test(text) ||
                        /(?:s\.shopee\.com\.br|shope\.ee)\/[a-zA-Z0-9_-]+/i.test(text) ||
                        /(?:amzn\.to\/[a-zA-Z0-9_-]+|amazon\.com\.br\/.*tag=)/i.test(text);

    if (!isAffiliate) return false;

    const feedback = document.querySelector(`[data-affiliate-feedback="${interventionId}"]`);
    if (feedback) feedback.innerHTML = '⚡ <strong>Link detectado!</strong> Validando e associando ao produto...';

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
      if (res.ok && result.success && (result.status === 'AFFILIATE_LINK_READY' || result.status === 'VERIFIED')) {
        if (activeWatcher) {
          clearInterval(activeWatcher);
          activeWatcher = null;
        }
        if (feedback) feedback.innerHTML = '✅ <strong>Link validado e salvo com sucesso!</strong> Abrindo criativo...';
        
        // Toca notificação de confirmação
        if (window.achakiAudio?.notifyResolved) window.achakiAudio.notifyResolved();

        if (window.loadDashboard) window.loadDashboard();
        if (window.loadCreativesGallery) window.loadCreativesGallery();

        // Abre automaticamente o modal de revisão do criativo 9:16
        setTimeout(() => {
          if (typeof window.openCreativeReviewModal === 'function') {
            window.openCreativeReviewModal(interventionId);
          }
        }, 400);

        return true;
      } else if (feedback && result.reason) {
        feedback.innerHTML = `⚠️ <span style="color:#f87171;">${escape(result.reason)}</span>`;
      }
    } catch (e) {
      if (feedback) feedback.innerHTML = `❌ <span style="color:#f87171;">Erro ao salvar: ${escape(e.message)}</span>`;
    }
    return false;
  }

  window.submitManualAffiliateLink = async function (interventionId) {
    const input = document.getElementById(`manualAffiliateInput-${interventionId}`);
    const text = input ? input.value.trim() : '';
    if (!text) {
      alert('Por favor, cole o link oficial de afiliado gerado (ex: https://meli.la/...).');
      return;
    }
    const ok = await submitAffiliateLink(interventionId, text);
    if (!ok) {
      const feedback = document.querySelector(`[data-affiliate-feedback="${interventionId}"]`);
      if (feedback && !feedback.textContent) {
        feedback.innerHTML = '⚠️ Link não reconhecido como oficial meli.la. Verifique e tente novamente.';
      }
    }
  };

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
    const prodUrl = escape(meta.productUrl || meta.product_url || '');
    const mkt = (item.marketplace || 'mercadolivre').toLowerCase();
    const mktName = mkt === 'mercadolivre' ? 'MERCADO LIVRE' : (mkt === 'shopee' ? 'SHOPEE' : (mkt === 'amazon' ? 'AMAZON' : mkt.toUpperCase()));
    let genUrl = item.targetUrl || item.target_url;
    if (!genUrl || genUrl === '#') {
      if (mkt === 'mercadolivre') genUrl = 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub';
      else if (mkt === 'shopee') genUrl = 'https://affiliate.shopee.com.br/offer/custom_link';
      else if (mkt === 'amazon') genUrl = prodUrl || 'https://www.amazon.com.br';
      else genUrl = 'https://www.mercadolivre.com.br/afiliados/linkbuilder#hub';
    }

    return `<div class="intervention-banner" id="interventionCard-${id}" style="margin-bottom:14px; border-color:rgba(59,130,246,0.5); background:linear-gradient(180deg, rgba(14,20,32,0.95) 0%, rgba(10,15,26,0.98) 100%);">
      <div class="intervention-header">
        <strong style="color:#60a5fa; font-size:0.95rem;">🛒 Produto selecionado</strong>
        <span style="font-size:0.75rem; color:var(--text-dim);">${item.time || ''}</span>
      </div>
      <div style="font-size:1.05rem; font-weight:800; color:#fff; margin-top:4px;">${escape(meta.productTitle || item.title)}</div>
      <div style="font-size:0.82rem; color:#cbd5e1; margin-top:4px;">
        <span style="text-transform:uppercase; font-weight:700; color:#f59e0b;">${escape(mktName)}</span> • 
        Preço: <strong style="color:#34d399; font-family:'JetBrains Mono';">${Number.isFinite(price) && meta.price != null ? escape(price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })) : 'Não informado'}</strong> • 
        Score: <strong style="color:#60a5fa;">${escape(scoreVal)}</strong>
      </div>

      ${ready ? `
        <div style="margin-top:12px; padding:12px; background:rgba(16,185,129,0.1); border:1px solid rgba(16,185,129,0.35); border-radius:10px;">
          <p style="color:#34d399; font-weight:700; font-size:0.88rem; margin:0 0 6px 0;">✅ Link de afiliado oficial validado e salvo!</p>
          <div style="font-size:0.75rem; color:#94a3b8; font-family:'JetBrains Mono'; word-break:break-all; margin-bottom:12px;">${escape(meta.affiliateUrl)}</div>
          <div style="display:flex; gap:8px; flex-wrap:wrap;">
            <button type="button" class="topbar-btn" onclick="openCreativeReviewModal('${id}')" style="background:#2563eb; border-color:#3b82f6; color:#fff; font-weight:800; font-size:0.82rem; padding:10px 14px; cursor:pointer;" title="Abrir player do vídeo vertical 9:16">🎬 REVISAR CRIATIVO 9:16</button>
            <button type="button" class="topbar-btn" onclick="promptRemakeCreative('${id}')" style="background:rgba(168,85,247,0.15); border-color:rgba(168,85,247,0.4); color:#d8b4fe; font-weight:800; font-size:0.82rem; padding:10px 14px; cursor:pointer;" title="Refazer vídeo mantendo produto e link oficial">♻️ REFAZER</button>
            <button type="button" class="topbar-btn topbar-btn-primary" onclick="publishFromAffiliateCard('${id}')" style="background:linear-gradient(135deg, #10b981 0%, #059669 100%); border-color:#34d399; color:#fff; font-weight:800; font-size:0.84rem; padding:10px 16px; box-shadow:0 0 16px rgba(16,185,129,0.35); cursor:pointer;" title="Publicar agora oferta com link oficial validado">🚀 PUBLICAR AGORA</button>
          </div>
        </div>
      ` : `
        <div style="margin-top:12px;">
          <a href="${escape(genUrl)}" target="_blank" rel="noopener noreferrer" class="topbar-btn topbar-btn-primary" data-affiliate-open="${id}" data-product-url="${prodUrl}" style="display:flex; width:100%; justify-content:center; text-decoration:none; padding:14px; font-size:0.95rem; font-weight:800; background:#2563eb; border-color:#3b82f6; color:#fff; box-shadow:0 0 18px rgba(37,99,235,0.45); cursor:pointer;">
            🔗 GERAR LINK NO ${escape(mktName)}
          </a>
          <div style="margin-top:10px; display:flex; gap:8px;">
            <input type="text" id="manualAffiliateInput-${id}" placeholder="Ou cole aqui o link meli.la gerado..." style="flex:1; background:rgba(15,23,42,0.9); border:1px solid rgba(255,255,255,0.25); border-radius:8px; padding:10px 12px; color:#fff; font-size:0.85rem; font-family:'JetBrains Mono',monospace;" onkeydown="if(event.key==='Enter') window.submitManualAffiliateLink('${id}')" />
            <button type="button" class="topbar-btn" onclick="window.submitManualAffiliateLink('${id}')" style="background:#10b981; border-color:#34d399; color:#fff; font-weight:800; font-size:0.82rem; padding:10px 16px; cursor:pointer;" title="Salvar link e avançar">Salvar</button>
          </div>
          ${meta.interventionRequired ? `<p style="color:#fbbf24; font-size:0.75rem; margin-top:6px;">⚠️ ${escape(meta.interventionRequired)}: conclua a verificação solicitada pelo marketplace nessa janela.</p>` : ''}
          ${meta.captureStatus === 'TIMED_OUT' ? `<p style="color:#f87171; font-size:0.75rem; margin-top:6px;">Link ainda não confirmado. Clique em GERAR LINK NO ${escape(mktName)} para retomar a captura.</p>` : ''}
        </div>
      `}
      ${!ready && ['ERROR', 'CLOSED'].includes(meta.captureStatus) ? `<p style="color:#f87171; font-size:0.75rem; margin-top:6px;">A captura foi interrompida. Clique em GERAR LINK NO ${escape(mktName)} para tentar novamente.</p>` : ''}
      <div data-affiliate-feedback="${id}" role="status" style="font-size:0.8rem; color:#38bdf8; margin-top:8px; font-weight:600;"></div>
    </div>`;
  };

  document.addEventListener('click', event => {
    const link = event.target.closest('[data-affiliate-open]');
    if (!link) return;
    const id = link.dataset.affiliateOpen;
    const prodUrl = link.dataset.productUrl;
    const feedback = link.parentElement.parentElement.querySelector(`[data-affiliate-feedback="${id}"]`) || document.querySelector(`[data-affiliate-feedback="${id}"]`);

    // 1. Cópia síncrona imediata da URL original do produto no gesto do clique
    if (prodUrl) {
      copySynchronously(prodUrl);
    }

    if (feedback) {
      feedback.innerHTML = '📋 <strong>URL copiada!</strong> Na página do gerador, dê <strong>Ctrl+V</strong> e clique em <em>Gerar</em>.<br>Quando você clicar em <strong>Copiar</strong> no Mercado Livre, o ACHAki segue o fluxo automaticamente!';
    }

    // 2. Dispara a notificação de comando ao backend em segundo plano (sem bloquear o link)
    fetch('/api/controls', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'OPEN_AFFILIATE_GENERATOR', interventionId: id }),
    }).catch(() => {});

    // 3. Inicia a escuta ativa da cópia no clipboard
    startClipboardWatcher(id);
  });

  window.publishFromAffiliateCard = async function (interventionId) {
    if (!confirm('Deseja aprovar o vídeo e publicar esta oferta agora com o link oficial de afiliado?')) return;
    try {
      const res = await fetch('/api/controls', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'APPROVE_AND_PUBLISH', interventionId })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        if (window.achakiAudio?.notifyResolved) window.achakiAudio.notifyResolved();
        alert('🚀 Oferta publicada com sucesso e vídeo salvo na galeria de criativos!');
        if (window.loadDashboard) window.loadDashboard();
        if (window.loadCreativesGallery) window.loadCreativesGallery();
      } else {
        alert('Falha na publicação: ' + (data.error || data.message || 'Erro desconhecido'));
      }
    } catch (e) {
      alert('Erro ao publicar: ' + e.message);
    }
  };

  window.remakeFromAffiliateCard = function (interventionId) {
    if (typeof window.promptRemakeCreative === 'function') {
      window.promptRemakeCreative(interventionId);
    }
  };
})();
