const H=require('./harness.cjs');
(async()=>{
  const ctx=await H.boot({storage:{'briix-media-live-token':'t'}});
  const {win}=ctx;
  const im=new win.Image();
  let fired=false; im.onload=()=>{fired=true;};
  im.src='blob:test/1';
  await H.settle(4,10);
  console.log('onload fired:',fired,'| instanceof win.Image:', im instanceof win.Image, '| ctor:', im.constructor.name);
  const u=win.URL.createObjectURL(new win.Blob(['x']));
  console.log('created',u,'live',ctx.bff.objectUrls.live.size);
  win.URL.revokeObjectURL(u); console.log('revoked count',ctx.bff.objectUrls.revoked);
  process.exit(0);
})();
