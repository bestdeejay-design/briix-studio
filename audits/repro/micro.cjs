'use strict';
const crypto=require('node:crypto');
// 1. перебор PIN (клиентский SHA-256(nick::pin), 4–6 цифр)
function bench(digits){
  const nick='audit', target=crypto.createHash('sha256').update(nick+'::'+'1234'.padEnd(digits,'0')).digest('hex');
  const t0=process.hrtime.bigint(); let n=0;
  const total=Math.pow(10,digits);
  for(let i=0;i<total;i++){
    const pin=String(i).padStart(digits,'0');
    if(crypto.createHash('sha256').update(nick+'::'+pin).digest('hex')===target){n=i;break;}
    n++;
  }
  const ms=Number(process.hrtime.bigint()-t0)/1e6;
  return {digits,candidates:total,ms:Math.round(ms)};
}
console.log('PIN brute-force (node, 1 поток):', JSON.stringify([bench(4),bench(5)]));
console.log('6 цифр = 1 000 000 хэшей, линейно:', Math.round(bench(5).ms*10),'мс');
// 2. safeFileName: копия функции из studio.js
const clean = s => String(s||'').replace(/[/\\:*?"<>|#%&{}$!'@+=`\u0301]/g,' ').replace(/\.{2,}/g,' ').replace(/\s+/g,' ').replace(/^[.\s]+|[.\s]+$/g,'');
const safeFileName=(title,artist,ext)=>{const safe=clean(clean(title)+' - '+clean(artist));return (safe||'briix-track-'+new Date().toISOString().slice(0,19).replace(/[:T]/g,'-'))+'.'+ext;};
const cases=[['[Intro]','audit'],['  ','audit'],['..','audit'],['AC/DC — Ночь','badai'],['Трек с очень длинным названием '.repeat(6),'оченьдлинныйникпользователя'],['🌙 Ночь','audit'],['Ёлка и combin\u0301ing','audit'],['','']];
for(const [t,a] of cases){const f=safeFileName(t,a,'m4a');console.log(JSON.stringify(t.slice(0,28)),'+',JSON.stringify(a.slice(0,20)),'→',JSON.stringify(f.slice(0,60)),'| байт UTF-8:',Buffer.byteLength(f));}
// 3. лимит имени файла
const worst=safeFileName('Название '.repeat(18).trim(),'Исполнительник','m4a');
console.log('MAX_TITLE=160 симв. кириллицы + ник 24 → байт UTF-8:',Buffer.byteLength(safeFileName('я'.repeat(160),'н'.repeat(24),'m4a')),'(лимит большинства ФС — 255 байт)');
// 4. дедупликация: сколько весит один ход чата
const reply='С'.repeat(1200), q='В'.repeat(200);
const history=[{role:'user',content:q},{role:'assistant',content:reply}];
const feed=[{t:'user',who:'Вы',text:q},{t:'assistant',who:'Наставник',text:reply,track:reply}];
console.log('один ход: history',JSON.stringify(history).length,'+ feed',JSON.stringify(feed).length,'=',JSON.stringify(history).length+JSON.stringify(feed).length,'байт; «чистый» вес текста',q.length+reply.length);
console.log('наценка хранения:',((JSON.stringify(history).length+JSON.stringify(feed).length)/(q.length+reply.length)).toFixed(2)+'×');
// 5. localStorage-квота при 200 ходах
const per=JSON.stringify(history).length+JSON.stringify(feed).length;
console.log('200 таких ходов ≈',(per*200/1024).toFixed(0),'КиБ (квота localStorage ~5 МиБ, фолбэк-бэкенд «local» пишет весь профиль одним ключом)');
