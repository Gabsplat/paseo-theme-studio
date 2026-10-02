import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
const origin=process.env.PASEO_QA_ORIGIN||'http://127.0.0.1:7789';
const qaHome=process.env.PASEO_QA_HOME||'/tmp/theme-studio-pack-qa';
const state=async()=>JSON.parse(await readFile(qaHome+'/theme-studio/studio.json','utf8'));
async function until(predicate){const end=Date.now()+10000;while(Date.now()<end){if(await predicate(await state()))return;await new Promise(r=>setTimeout(r,100));}throw Error('State assertion timed out');}
const browser=await chromium.launch({headless:true,executablePath:process.env.PASEO_QA_CHROMIUM||'/home/gabsplat/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome',args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:1920,height:1080}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
try {
 await page.goto(origin);await page.getByText('Theme Studio',{exact:true}).first().click();const studioUrl=page.url();let studio=page.getByTestId('theme-studio');await studio.waitFor();
 await page.goto(origin+'/settings/appearance');await page.getByText('System',{exact:true}).click();await page.getByText('Theme Studio · Live',{exact:true}).click();await page.goto(studioUrl);await studio.waitFor();
 const original=await state();const before=await studio.getByRole('button',{name:'Pack active',exact:true}).first().evaluate(n=>getComputedStyle(n).backgroundColor);
 await studio.getByRole('button',{name:'Colors',exact:true}).click();const accent=studio.getByTestId('color-accent');await accent.fill('#F06BFF');await accent.press('Enter');await until(d=>d.current.colors.accent==='#F06BFF');
 assert.deepEqual((await state()).active,original.active);assert.equal(await studio.getByRole('button',{name:'Activate pack',exact:true}).first().evaluate(n=>getComputedStyle(n).backgroundColor),before);
 await studio.getByRole('button',{name:'Design',exact:true}).click();await studio.getByRole('button',{name:'Compact',exact:true}).first().click();await until(d=>d.current.ui.density==='compact');
 await studio.getByRole('button',{name:'Mono',exact:true}).click();await until(d=>d.current.ui.fontFamily==='mono');
 await studio.getByRole('button',{name:'Bordered',exact:true}).click();await until(d=>d.current.ui.toolCards==='bordered');
 await studio.getByRole('button',{name:'Card',exact:true}).click();await until(d=>d.current.ui.messageStyle==='card');
 await studio.getByRole('switch',{name:'Activity panel',exact:true}).click();await until(d=>d.current.ui.activityPanel);
 await studio.getByRole('button',{name:'Edit panel blocks',exact:true}).click();
 await page.getByRole('switch',{name:'Custom panel',exact:true}).click();await page.getByRole('textbox',{name:'Custom panel title',exact:true}).fill('QA notes');
 await page.getByRole('button',{name:'Add text',exact:true}).click();await page.getByRole('textbox',{name:'Block 1 text',exact:true}).fill('This is a generated native panel.');
 await page.getByRole('button',{name:'Add stat',exact:true}).click();await page.getByRole('button',{name:'Add list',exact:true}).click();await page.getByRole('button',{name:'Add progress',exact:true}).click();
 await page.getByRole('button',{name:'Apply panel draft',exact:true}).click();await until(d=>d.current.ui.panel.title==='QA notes');assert.deepEqual((await state()).active,original.active);
 await page.screenshot({path:'output/theme-studio-pack-design.png'});
 await studio.getByRole('button',{name:'Activate pack',exact:true}).first().click();await until(d=>d.active?.ui.panel.title==='QA notes');await page.waitForTimeout(1500);
 assert.equal(await studio.getByRole('button',{name:'Pack active',exact:true}).first().evaluate(n=>getComputedStyle(n).backgroundColor),'rgb(240, 107, 255)');
 await studio.getByRole('button',{name:'Export',exact:true}).click();await page.getByRole('button',{name:'Export plugin',exact:true}).click();await page.getByText('Typecheck passed',{exact:true}).waitFor({timeout:30000});
 const command=await page.getByText(/^paseo plugin install /).innerText();const directory=command.match(/^paseo plugin install '([^']+)'$/)[1];
 await writeFile('output/pack-qa-artifact.json',JSON.stringify({directory,command},null,2));await page.screenshot({path:'output/theme-studio-pack-export.png'});await page.keyboard.press('Escape');
 await page.getByText('Pack QA workspace',{exact:true}).first().click();await page.keyboard.press('Control+k');await page.getByPlaceholder('Search commands, files, workspaces, and agents...').fill('Open QA notes');
 await page.getByText('Open QA notes',{exact:true}).click();await page.getByText('This is a generated native panel.',{exact:true}).waitFor();await page.screenshot({path:'output/theme-studio-pack-native-panel.png'});
 await page.goto(studioUrl);await studio.waitFor();await studio.getByRole('button',{name:'Design',exact:true}).click();await studio.getByRole('button',{name:'Revert pack',exact:true}).click();await until(d=>JSON.stringify(d.active)===JSON.stringify(original.active));
 await studio.getByRole('button',{name:'Disable pack',exact:true}).click();await until(d=>d.active===null);await studio.getByRole('button',{name:'Revert pack',exact:true}).click();await until(d=>JSON.stringify(d.active)===JSON.stringify(original.active));
 await page.setViewportSize({width:430,height:932});await page.waitForTimeout(500);await page.goto(studioUrl);await studio.waitFor();await studio.getByRole('button',{name:'Design',exact:true}).click();await page.screenshot({path:'output/theme-studio-pack-compact.png'});
 console.log(JSON.stringify({checks:['draft does not alter global theme','density/fonts/cards/notes','native block builder','explicit activation','global palette updates on activation','typechecked standalone export','native workspace panel','rollback','disable/restore','compact layout'],errors},null,2));assert.equal(errors.length,0);
} catch(error){await page.screenshot({path:'output/theme-studio-pack-error.png'});console.log(JSON.stringify({url:page.url(),errors,alerts:await page.getByRole('alert').allTextContents()}));throw error;} finally {await browser.close();}
