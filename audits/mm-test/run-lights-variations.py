#!/usr/bin/env python3
# Легендарная лирика («Всегда одна») + вариации промтов: 3 генерации на ace
import json, os, time, urllib.request
BASE="https://demo.briix.ru/api"; TOKEN=os.environ["BFF_TOKEN"]
OUT=os.path.expanduser("~/Downloads/briix-ab")
def get(path):
    req=urllib.request.Request(BASE+path, headers={"Authorization":"Bearer "+TOKEN})
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
def post(body):
    for a in range(5):
        try:
            req=urllib.request.Request(BASE+"/jobs", data=json.dumps(body).encode(),
                headers={"Authorization":"Bearer "+TOKEN, "Content-Type":"application/json"})
            with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())["job_id"]
        except Exception as e:
            print("retry",a,e,flush=True); time.sleep(10)
def dl(url, dst):
    req=urllib.request.Request(BASE+url, headers={"Authorization":"Bearer "+TOKEN})
    with urllib.request.urlopen(req, timeout=300) as r, open(dst,"wb") as f: f.write(r.read())
LYR=open("/Users/best/Projects/briix-studio-build/audits/mm-test/lyr-lights-correct.txt").read().strip()
PROMPTS = {
 "vA Legendary-промт": "fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric",
 "vB +warm beat 170bpm": "fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric, warm beat, 170bpm",
 "vC Lo-fi вариант": "Lo-fi, fast jungle beats, reverb guitar, deep bass, dreamy atmosphere",
}
ids={}
for pname, cap in PROMPTS.items():
    name=f"ace-step-flash v1 — A Thousand Lights {pname} (легендарная лирика)"
    body={"type":"music","prompt":cap,
      "params":{"model":"ace-step-flash","lyrics":LYR,"language":"ru",
      "duration":196,"format":"wav","seed":51004,"title":name}}
    jid=post(body); ids[name]=jid; print("submitted",name,jid,flush=True)
open("/Users/best/Projects/briix-studio-build/audits/mm-test/ids-lights-var.json","w").write(json.dumps(ids))
pending=dict(ids); deadline=time.time()+150*60
while pending and time.time()<deadline:
    time.sleep(20)
    for name,jid in list(pending.items()):
        try: j=get("/jobs/"+jid)
        except Exception as e: print("poll err",name,e,flush=True); continue
        st=j.get("status"); print(time.strftime("%H:%M:%S"),name,st,j.get("stage",""),flush=True)
        if st in ("ready","error"):
            del pending[name]
            if st=="ready":
                u=j.get("formats",{}).get("m4a",{}).get("url")
                if u:
                    try:
                        dl(u,os.path.join(OUT,name+".m4a")); print("got",name+".m4a",flush=True)
                        from mutagen.mp4 import MP4
                        m=MP4(os.path.join(OUT,name+".m4a")); m["\xa9nam"]=name; m.save()
                    except Exception as e: print("dl err",e,flush=True)
            else: print("JOB ERROR",name,json.dumps(j)[:200],flush=True)
print("ALL DONE", pending, flush=True)
