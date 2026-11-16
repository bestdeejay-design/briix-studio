const H=require('./harness.cjs');
const LYR='[Verse 1]\nline one\n[Chorus]\nline two';
(async()=>{
  const ctx=await H.boot({storage:{'briix-media-live-token':'test-token'},timeScale:60,
    chatScript:(m)=>/автор песен/i.test(String(m[0].content))?LYR:'ok'});
  const {doc}=ctx; await H.login(ctx);
  H.click(doc.querySelector('.mode[data-mode="music"]')); await H.settle();
  H.setVal(doc.getElementById('prompt'),'neo soul, female vocals');
  H.click(doc.getElementById('genTrack'));
  await H.settle(200,15);
  const cover=doc.querySelector('.track-cover');
  const a=doc.querySelector('audio');
  console.log('cover:',!!cover,'playBound:',cover&&cover.dataset.playBound,'role:',cover&&cover.getAttribute('role'));
  console.log('audio:',!!a,'paused:',a.paused,'__paused:',a.__paused,'src:',a.src);
  let ev=0; a.addEventListener('play',()=>ev++);
  H.click(cover); await H.settle(10,15);
  console.log('после клика: play events',ev,'paused',a.paused,'__paused',a.__paused,'class',cover.className);
  process.exit(0);
})();
