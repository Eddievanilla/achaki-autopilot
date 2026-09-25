async function checkLive() {
  const r = await fetch('https://achaki-autopilot.vercel.app/?t=' + Date.now(), {
    headers: { 'Cache-Control': 'no-cache' }
  });
  const html = await r.text();
  console.log('HTML Length:', html.length);
  console.log('Has Criativos in HTML:', html.includes('tab-creatives'));
  console.log('Has Diário de Decisões:', html.includes('renderCommercialDiary'));
  const navMatches = html.match(/class="nav-label">([^<]+)<\/span>/g);
  console.log('Nav Labels found:', navMatches);

  // Check what diary items look like in public/index.html
  const diaryBlock = html.match(/id="diaryEventsContainer"[\s\S]{1,400}/);
  console.log('diaryEventsContainer snippet:', diaryBlock ? diaryBlock[0].slice(0, 300) : 'not found');
}
checkLive();
