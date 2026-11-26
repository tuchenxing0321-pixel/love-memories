(function(){
  const coverMaxBytes=2*1024*1024;
  let cache={vlog:[],dancee:[]},access={canWrite:false,role:'viewer'};
  const call=(action,payload={})=>window.CloudBaseClient.callFunction('videoApi',action,payload);

  function safeUrl(value){
    try{const url=new URL(String(value||''));return url.protocol==='https:'||url.protocol==='http:'?url.href:''}catch{return''}
  }

  function normalizeDate(value){
    const match=String(value||'').trim().match(/^(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})$/);
    if(!match)return'';
    const [,year,month,day]=match,date=new Date(`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}T00:00:00Z`);
    if(Number.isNaN(date.getTime())||date.getUTCFullYear()!==Number(year)||date.getUTCMonth()+1!==Number(month)||date.getUTCDate()!==Number(day))return'';
    return `${year}.${String(month).padStart(2,'0')}.${String(day).padStart(2,'0')}`;
  }

  function dateKey(value){return normalizeDate(value).replaceAll('.','-')}
  function coverScale(width,height){return Math.min(1,1200/Math.max(width,height))}

  function isPlaceholderUrl(value){
    const fullUrl=safeUrl(value);
    if(!fullUrl)return false;
    const url=new URL(fullUrl);
    return url.hostname.toLowerCase()==='v.douyin.com'&&/^\/example\/?$/i.test(url.pathname);
  }

  function read(){return cache}
  function canWrite(){return access.canWrite}
  async function load(){
    access={canWrite:false,role:'viewer'};
    const data=await call('listVideos');
    if(!data||!Array.isArray(data.vlog)||!Array.isArray(data.dancee))throw new Error('云端视频数据格式不正确');
    cache={vlog:data.vlog,dancee:data.dancee};
    try{access=await call('getVideoAccess')}catch{access={canWrite:false,role:'viewer'}}
    return cache;
  }

  async function add(category,item){
    const url=safeUrl(item?.url);
    if(!['vlog','dancee'].includes(category)||!url)throw new Error('只支持 http 或 https 视频链接');
    if(isPlaceholderUrl(url))throw new Error('请粘贴真实视频链接');
    if(!canWrite())throw new Error('只有主人或管理员可以添加视频');
    const saved=await call('addVideo',{category,url,name:String(item.name||'').trim(),date:normalizeDate(item.date),cover:item.cover||''});
    cache[category].unshift(saved);
    return saved;
  }

  async function remove(category,id){
    if(!canWrite())throw new Error('只有主人或管理员可以删除视频');
    await call('removeVideo',{id});
    cache[category]=cache[category].filter(item=>item.id!==id);
  }

  async function setCover(category,id,cover){
    if(!canWrite())throw new Error('只有主人或管理员可以修改封面');
    await call('setVideoCover',{id,cover});
    const item=cache[category].find(entry=>entry.id===id);
    if(item)item.cover=cover;
  }

  function isDouyin(value){const url=safeUrl(value);return Boolean(url)&&/(^|\.)douyin\.com$/i.test(new URL(url).hostname)}

  function title(item){
    if(item?.name?.trim())return item.name.trim();
    if(item?.autoName?.trim())return item.autoName.trim();
    try{return new URL(safeUrl(item?.url)).hostname.replace(/^www\./,'')||'视频链接'}catch{return '视频链接'}
  }

  function coverFromFile(file){
    return new Promise((resolve,reject)=>{
      if(!file?.type.startsWith('image/'))return reject(new Error('请选择图片文件'));
      if(file.size>20*1024*1024)return reject(new Error('封面图片不能超过 20 MB'));
      const image=new Image(),reader=new FileReader();
      reader.onerror=()=>reject(new Error('图片读取失败'));
      reader.onload=()=>{image.src=reader.result};
      image.onerror=()=>reject(new Error('图片无法打开'));
      image.onload=()=>{
        const scale=coverScale(image.width,image.height),canvas=document.createElement('canvas');
        canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));
        canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
        let quality=.82,data=canvas.toDataURL('image/jpeg',quality);
        while(Math.floor((data.split(',')[1]||'').length*3/4)>coverMaxBytes&&quality>.52){quality-=.1;data=canvas.toDataURL('image/jpeg',quality)}
        if(Math.floor((data.split(',')[1]||'').length*3/4)>coverMaxBytes)return reject(new Error('封面压缩后仍超过 2 MB'));
        resolve(data);
      };
      reader.readAsDataURL(file);
    });
  }

  function pickCover(){
    return new Promise(resolve=>{
      const input=document.createElement('input');input.type='file';input.accept='image/*';
      input.onchange=()=>input.files[0]?coverFromFile(input.files[0]).then(resolve).catch(()=>resolve('')):resolve('');
      input.click();
    });
  }

  function bilibiliId(url){return url.match(/BV[a-zA-Z0-9]{10}/)?.[0]||''}

  function enrich(category,item){
    const bvid=bilibiliId(item.url);
    if(!bvid||item.cover)return Promise.resolve(item);
    return new Promise(resolve=>{
      const callback=`biliMeta_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const script=document.createElement('script');
      const finish=updated=>{delete window[callback];script.remove();resolve(updated)};
      const timer=setTimeout(()=>finish(item),8000);
      window[callback]=response=>{
        clearTimeout(timer);
        if(response?.code!==0)return finish(item);
        const published=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(response.data.pubdate*1000));
        const updated={...item,cover:response.data.pic.replace(/^http:/,'https:'),autoName:response.data.title,date:normalizeDate(published)};
        finish(updated);
      };
      script.onerror=()=>{clearTimeout(timer);finish(item)};
      script.src=`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}&jsonp=jsonp&callback=${callback}`;
      document.head.append(script);
    });
  }

  console.assert(title({url:'https://example.com/watch'})==='example.com'&&safeUrl('javascript:alert(1)')===''&&isPlaceholderUrl('https://v.douyin.com/example/')&&normalizeDate('2026.9.3')==='2026.09.03'&&dateKey('2026.11.10')>dateKey('2026.9.30')&&Math.abs(coverScale(1000,4000)-.3)<.001,'视频链接、日期或封面缩放校验异常');
  window.VideoLibrary={load,read,canWrite,add,remove,setCover,isDouyin,isPlaceholderUrl,title,coverFromFile,pickCover,enrich,safeUrl,normalizeDate,dateKey};
})();
