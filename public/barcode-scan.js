/* Retail-barcode decoding helpers shared by the browser and Node tests. */
(function attach(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.BarcodeScan=api;
})(typeof globalThis==='object'?globalThis:null,function(){
  const FORMATS={ean_13:13,ean_8:8,upc_a:12,itf:14};
  function cijfers(value){return String(value??'').replace(/\D/g,'')}
  function checkDigit(code){
    let sum=0;
    for(let i=code.length-2,weight=3;i>=0;i-=1,weight=weight===3?1:3)sum+=Number(code[i])*weight;
    return String((10-sum%10)%10);
  }
  function geldig(code,length){return code.length===length&&checkDigit(code)===code.at(-1)}
  function breidUpcEuit(code){
    if(code.length!==8||!['0','1'].includes(code[0]))return null;
    const ns=code[0], [a,b,c,d,e,f]=code.slice(1,7), controle=code[7];
    let basis;
    if('012'.includes(f))basis=`${ns}${a}${b}${f}0000${c}${d}${e}`;
    else if(f==='3')basis=`${ns}${a}${b}${c}00000${d}${e}`;
    else if(f==='4')basis=`${ns}${a}${b}${c}${d}00000${e}`;
    else basis=`${ns}${a}${b}${c}${d}${e}0000${f}`;
    const uitgebreid=`${basis}${controle}`;
    return geldig(uitgebreid,12)?uitgebreid:null;
  }
  function normaliseer(rawValue,format){
    const code=cijfers(rawValue);
    if(format==='upc_e')return breidUpcEuit(code);
    const length=FORMATS[format];
    return length&&geldig(code,length)?code:null;
  }
  // Neem alleen één barcode aan die in drie opeenvolgende cameraframes gelijk blijft.
  // Meerdere verschillende geldige codes in beeld zijn ambigu en resetten de lezing.
  function volgendeLezing(previous,count,results,required=3){
    const codes=[...new Set((Array.isArray(results)?results:[])
      .map(result=>normaliseer(result?.rawValue,result?.format))
      .filter(Boolean))];
    if(codes.length!==1)return{code:'',count:0,accepted:false};
    const code=codes[0],zelfde=code===previous;
    const hits=zelfde?Math.min(Number(count)||0,required-1)+1:1;
    return{code,count:hits,accepted:hits>=required};
  }
  return{normaliseer,volgendeLezing};
});
