(function(){
  const category=document.body.dataset.videoCategory;
  const grid=document.getElementById('grid');
  const empty=document.getElementById('empty');
  const manage=document.getElementById('manage');
  const count=document.getElementById('count');
  const status=document.getElementById('collection-status');
  const emptyMarkup=empty.innerHTML;

  function paint(card,item,index){
    const cover=card.querySelector('.cover');
    const old=cover.querySelector('img,.link-cover');
    if(item.cover){
      const image=document.createElement('img');
      image.src=item.cover;image.alt=`${VideoLibrary.title(item)} 封面`;
      image.referrerPolicy='no-referrer';image.loading=index<4?'eager':'lazy';image.decoding='async';
      if(index===0)image.fetchPriority='high';
      old.replaceWith(image);
    }else old.textContent=VideoLibrary.isDouyin(item.url)?'＋ 封面':new URL(item.url).hostname.replace(/^www\./,'');
    card.querySelector('h2').textContent=VideoLibrary.title(item);
  }

  function showError(error){status.hidden=false;status.dataset.error='true';status.textContent=error?.message||'操作失败，请重试。'}
  function render(){
    grid.replaceChildren();
    const items=VideoLibrary.read()[category];
    items.forEach((item,index)=>{
      const wrapper=document.createElement('div');wrapper.className='item';
      wrapper.innerHTML='<button class="delete" type="button">×</button><a class="card" target="_blank" rel="noopener noreferrer"><div class="cover"><div class="link-cover"></div><span class="mark">↗</span></div><h2></h2></a>';
      const card=wrapper.querySelector('.card');
      const deleteButton=wrapper.querySelector('.delete');
      card.href=item.url;deleteButton.hidden=!VideoLibrary.canWrite();
      deleteButton.setAttribute('aria-label',`删除${VideoLibrary.title(item)}`);
      paint(card,item,index);
      card.addEventListener('click',async event=>{
        if(item.cover||!VideoLibrary.isDouyin(item.url)||!VideoLibrary.canWrite())return;
        event.preventDefault();
        const cover=await VideoLibrary.pickCover();
        if(!cover)return;
        try{await VideoLibrary.setCover(category,item.id,cover);item.cover=cover;paint(card,item,index)}catch(error){showError(error)}
      });
      VideoLibrary.enrich(category,item).then(updated=>{paint(card,updated,index);deleteButton.setAttribute('aria-label',`删除${VideoLibrary.title(updated)}`)});
      deleteButton.addEventListener('click',async()=>{
        if(!confirm(`确定从本网站删除“${VideoLibrary.title(item)}”吗？`))return;
        deleteButton.disabled=true;
        try{await VideoLibrary.remove(category,item.id);render()}
        catch(error){deleteButton.disabled=false;showError(error)}
      });
      grid.append(wrapper);
    });
    empty.hidden=items.length>0;
    empty.innerHTML=VideoLibrary.canWrite()?emptyMarkup:'<span>这里还没有收录视频。</span>';
    count.textContent=`${String(items.length).padStart(2,'0')} FILMS`;
    manage.hidden=!VideoLibrary.canWrite()||items.length===0;
    if(manage.hidden){grid.classList.remove('managing');manage.setAttribute('aria-pressed','false');manage.textContent='管理'}
  }

  manage.addEventListener('click',()=>{const active=!grid.classList.contains('managing');grid.classList.toggle('managing',active);manage.setAttribute('aria-pressed',String(active));manage.textContent=active?'完成':'管理'});
  document.getElementById('back').addEventListener('click',()=>{let fromVideo=false;try{fromVideo=new URL(document.referrer).pathname.endsWith('/video.html')}catch{}if(fromVideo&&history.length>1)history.back();else location.replace('video.html')});
  async function load(){
    status.hidden=false;status.dataset.error='false';status.textContent='正在读取共享视频…';
    try{await VideoLibrary.load();render();status.hidden=true}
    catch(error){manage.hidden=true;empty.hidden=true;showError(error)}
  }
  load();
  addEventListener('pageshow',event=>{if(event.persisted)load()});
})();
