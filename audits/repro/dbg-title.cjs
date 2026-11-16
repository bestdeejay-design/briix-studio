const H=require('./harness.cjs');
const LYR='[Verse 1]\nГород дышит неоном\n[Chorus]\nНочной город, пой со мной';
(async()=>{
  const ctx=await H.boot({storage:{'briix-media-live-token':'test-token'},timeScale:60,peaksShape:'array',
    chatScript:(m)=>/briix-draft/.test(String(m[0].content))
      ? 'Собрал.\n\n[briix-draft]\n{"title":"Неон и вода","prompt":"psychedelic soul, female vocals","lyrics":'+JSON.stringify(LYR)+'}\n[/briix-draft]'
      : (/автор песен/i.test(String(m[0].content))?LYR:'ok')});
  const {doc}=ctx; await H.login(ctx,'audit');
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'),'собери трек про ночной город');
  H.click(doc.getElementById('send')); await H.settle(40,20);
  const gen=[...doc.querySelectorAll('.music-draft .producer-actions button')].find(b=>/Сгенерировать/.test(b.textContent));
  H.click(gen); await H.settle(200,15);
  const cardEl=doc.querySelector('#feed .card.assistant:last-of-type')||[...doc.querySelectorAll('#feed .card')].pop();
  const clone=cardEl.cloneNode(true); clone.querySelectorAll('details').forEach(d=>d.remove());
  console.log('=== карточка трека БЕЗ transparency-блока ===');
  console.log(JSON.stringify(clone.textContent.replace(/\s+/g,' ').trim()));
  console.log('название «Неон и вода» видно?', clone.textContent.includes('Неон и вода'));
  console.log('внутри <details> (свёрнуто):', /Неон и вода/.test(cardEl.textContent));
  // библиотека
  H.click(doc.querySelector('.tab[data-tab="library"]')); await H.settle(60,15);
  const li=doc.querySelector('.lib-item');
  console.log('=== карточка библиотеки ===');
  console.log(JSON.stringify(li?li.textContent.replace(/\s+/g,' ').trim().slice(0,300):'НЕТ'));
  console.log('название видно в библиотеке?', li?li.textContent.includes('Неон и вода'):'—');
  console.log('заголовок/who:', JSON.stringify(li?li.querySelector('.who').textContent:''));
  process.exit(0);
})();
