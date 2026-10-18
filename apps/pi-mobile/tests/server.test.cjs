'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

// Use a fake RPC Pi binary so tests do not require Android/Termux or credentials.
test('Bridge exposes health, blocks unauthenticated clients and relays RPC', async (t)=>{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'pi-mobile-'));
  const piBin = path.join(dir,'fake-pi.cjs');
  const port = 8800 + Math.floor(Math.random()*600);
  fs.writeFileSync(piBin, `#!/usr/bin/env node\nprocess.stdin.setEncoding('utf8');let b='';process.stdin.on('data',c=>{b+=c;let i;while((i=b.indexOf('\\n'))>=0){let o=JSON.parse(b.slice(0,i));b=b.slice(i+1);console.log(JSON.stringify({type:'response',id:o.id,command:o.type,success:true,data:{model:{provider:'openrouter',id:'test'},models:[],messages:[]}}));if(o.type==='prompt'){console.log(JSON.stringify({type:'message_update',assistantMessageEvent:{type:'text_delta',delta:'hi'}}));console.log(JSON.stringify({type:'agent_settled'}));}}});\n`,{mode:0o755});
  const serverFile=path.join(__dirname,'../termux/server.cjs');
  const child=spawn(process.execPath,[serverFile],{env:{...process.env,PI_MOBILE_PORT:String(port),PI_MOBILE_TOKEN_FILE:path.join(dir,'token'),PI_MOBILE_WORKSPACE:dir,PI_MOBILE_PI_BIN:piBin},stdio:['ignore','pipe','pipe']});
  t.after(()=>{child.kill('SIGKILL');fs.rmSync(dir,{recursive:true,force:true});});
  const url='http://127.0.0.1:'+port;
  let health;
  for(let i=0;i<60;i++){
    try{health=await fetch(url+'/health').then(r=>r.json());if(health.piRunning)break;}catch(_){}
    await new Promise(r=>setTimeout(r,80));
  }
  assert.equal(health?.piRunning,true,'server and fake Pi must start');
  const html=await fetch(url+'/').then(r=>r.text()); assert.match(html,/Pi Mobile/);
  const denied=await fetch(url+'/rpc',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"type":"get_state"}'});assert.equal(denied.status,401);
  const token=fs.readFileSync(path.join(dir,'token'),'utf8').trim();
  const headers={Authorization:'Bearer '+token,'X-Pi-Mobile':'1','Content-Type':'application/json'};
  const allowed=await fetch(url+'/rpc',{method:'POST',headers,body:'{"type":"get_state"}'});assert.equal(allowed.status,200);assert.equal((await allowed.json()).data.model.provider,'openrouter');
  const bad=await fetch(url+'/rpc',{method:'POST',headers,body:'{"type":"bash","command":"pwd"}'});assert.equal(bad.status,400);
  const foreign=await fetch(url+'/rpc',{method:'POST',headers:{...headers,Origin:'https://attacker.example'},body:'{"type":"get_state"}'});assert.equal(foreign.status,403);
  const prompt=await fetch(url+'/rpc',{method:'POST',headers,body:'{"type":"prompt","message":"oi"}'});assert.equal(prompt.status,200);
});
