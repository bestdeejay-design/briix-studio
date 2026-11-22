#!/usr/bin/env python3
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
name="ace-step-flash v1 — A Thousand Lights Legendary (правильная лирика)"
body={"type":"music",
  "prompt":"fast jungle beats, female vocals, reverb guitar, deep bass, dreamy atmospheric",
  "params":{"model":"ace-step-flash","lyrics":open("/Users/best/Projects/briix-studio-build/audits/mm-test/lyr-lights-correct.txt").read().strip(),
  "language":"ru","duration":196,"format":"wav","seed":51004,"title":name}}
jid=post(body); print("submitted",name,jid,flush=True)
deadline=time.time()+60*60
while time.time()<deadline:
    time.sleep(20)
    try: j=get("/jobs/"+jid)
    except Exception as e: print("poll err",e,flush=True); continue
    st=j.get("status"); print(time.strftime("%H:%M:%S"),st,j.get("stage",""),flush=True)
    if st in ("ready","error"):
        if st=="ready":
            u=j.get("formats",{}).get("m4a",{}).get("url")
            if u:
                try:
                    dl(u,os.path.join(OUT,name+".m4a")); print("got",name+".m4a",flush=True)
                    from mutagen.mp4 import MP4
                    m=MP4(os.path.join(OUT,name+".m4a")); m["\xa9nam"]=name; m.save()
                except Exception as e: print("dl err",e,flush=True)
        else: print("JOB ERROR",json.dumps(j)[:200],flush=True)
        break
print("ALL DONE",flush=True)
