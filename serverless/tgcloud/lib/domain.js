export const OWNER_ID=340780041, BOT_USERNAME='SerbiaDealsBot';
export const safe=value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export const positive=value=>Number.isSafeInteger(value)&&value>0;
export const requireValue=(value,message='Invalid input')=>{if(!value)throw Error(message);};
const cyr=Object.fromEntries([...'абвгдђежзијклљмнњопрстћуфхцчџш'].map((c,i)=>[c,['a','b','v','g','d','dj','e','z','z','i','j','k','l','lj','m','n','nj','o','p','r','s','t','c','u','f','h','c','c','dz','s'][i]]));
export function normalize(value){return String(value).toLowerCase().replace(/[абвгдђежзијклљмнњопрстћуфхцчџш]/g,c=>cyr[c]).replace(/đ/g,'dj').normalize('NFKD').replace(/\p{M}/gu,'').replace(/\b(e|gu)\s+(\d+)\b/g,'$1$2').replace(/(\d)\s+(w|lm|k|kg|g|ml|l)\b/g,'$1$2').replace(/_/g,' ').match(/[\p{L}\p{N}]+/gu)?.join(' ')||'';}
const words={
 'лампочка':['sijalic','zarulj'], 'лампочки':['sijalic','zarulj'], 'лампа':['sijalic','lamp'],
 'молоко':['mleko','mlijeko'], 'кофе':['kafa','coffee'], 'яйца':['jaja','jaje'],
 'масло':['ulje','maslac'], 'сахар':['secer'], 'мука':['brasno'], 'сыр':['sir'],
 'батарейка':['baterij'], 'батарейки':['baterij'], 'порошок':['deterdzent','prasak'],
 'шампунь':['sampon'], 'мыло':['sapun'], 'подгузники':['pelen'], 'бумага':['papir'],
 'хлеб':['hleb','kruh'], 'рис':['pirinac','riza'], 'вода':['voda'], 'чай':['caj'],
 'макароны':['testenin','pasta'], 'корм':['hrana'], 'лампочку':['sijalic','zarulj']
};
const shoppingWords=[
 ['огурец огурцы огурцов огурца','krastav'],['помидор помидоры помидоров томат томаты','paradajz rajcic'],
 ['картошка картофель картофеля картошку','krompir krumpir'],['морковь морковка','sargarep mrkv'],['лук лука','luk'],['чеснок чеснока','beli cesnjak'],
 ['капуста капусты','kupus'],['кабачок кабачки','tikvic'],['баклажан баклажаны','patlidzan'],['перец перцы','paprik'],['салат салата','salat'],
 ['яблоко яблоки яблок яблоками','jabuk'],['банан бананы бананов','banan'],['апельсин апельсины','pomorand narand'],['мандарин мандарины','mandarin'],
 ['слива сливы сливу сливами','sljiv'],['песто','pesto'],['соус соусы соуса','sos umak preliv'],
 ['лимон лимоны','limun'],['груша груши','krusk'],['клубника клубнику','jagod'],['виноград винограда','grozd'],['арбуз арбузы','lubenic'],['авокадо','avokad'],
 ['яйцо яиц яйцами','jaja jaje'],['курица курицу курицы куриный куриная куриную куриное куриные куриных','pile pilet'],['индейка индейку индейки индюшка индюшки индюшатина','curet'],['говядина говядину говядины говяжий говяжье говяжья говяжьи говяжью','goved junec'],
 ['свинина свинину свинины свиной свиное свиная свиную свиные','svinj'],['мясо мяса meso месо','meso pile pilet goved junec svinj curet'],['фарш фарша','mleven mljeven'],['рыба рыбу рыбы рыбка рыбки рыбку riba ribe ribu','riba riblj losos tunjevin tuna pastrm skus sardin haring oslic bakalar brancin orada smudj saran som pangasius pangaz tilapi incun papalin giric'],['лосось лосося salmon','losos salmon'],['тунец тунца tuna tunjevina','tunjevin tuna'],
 ['колбаса колбасу колбасы','kobasic salam'],['сосиски сосисок','virsl hrenov'],['ветчина ветчину','sunk'],['бекон бекона','slanin bacon'],
 ['йогурт йогурты йогурта','jogurt yogurt'],['кефир кефира','kefir'],['сметана сметану','pavlak'],['сливки сливок','pavlak vrhnj'],['творог творога','sir'],
 ['сыра сыры','sir'],['молока молочку','mleko mlijeko'],['шоколад шоколада шоколадка','cokolad'],['печенье печенья','keks biskvit'],['мороженое мороженого','sladoled'],
 ['сок соки сока','sok'],['газировка газировку','gaziran cola kola'],['пиво пива','pivo'],['вино вина','vino'],['минералка минералку','mineraln'],
 ['энергетик энергетики энергетика энергетиков энергетический энергетические энергетического','energet energij energy red redbull guarana monster hell ultra'],
 ['напиток напитки напитка','napit pic drink'],['чая','caj'],['кофейный','kafa coffee'],['меда мёд мед','med'],['соль соли','so soli'],
 ['гречка гречку','heljd'],['овсянка овсянку овсяные','ovsen zob'],['хлопья хлопьев','pahulj'],['хлеба батон','hleb kruh baget'],['макарон спагетти','testenin spaget pasta'],
 ['кетчуп кетчупа','kecap ketchup'],['майонез майонеза','majonez'],['орехи орехов','oras orah lesnik badem'],['арахис арахиса','kikiriki'],
 ['шампуни шампуня','sampon'],['мыла','sapun'],['паста пасту','pasta'],['зубная зубную','zub'],['салфетки салфеток','maramic salvete'],
 ['батареек','baterij'],['губка губки','sundjer spuzv'],['пакет пакеты','kes vrec'],['туалетная туалетную','toalet'],
 ['маринованные маринованный солёные соленые солёный соленый','kisel marin paster'],
 ['консервированные консервированный','konzerv'],
 ['молотый молотая молотого','mleven mljeven'],['растворимый растворимого','instant rastvor'],
 ['зёрна зерна зёрнах зернах зерновой','zrn'],['капсулы капсулах капсульный','kapsul'],
 ['чёрный черный чёрного черного','crn black'],['зелёный зеленый зелёного зеленого','zelen green'],
 ['негазированная негазированную негазированной','negaz'],['газированная газированную газированной','gaziran'],
 ['филе','file filet'],['грудка грудку грудки','grud prs belo'],['бедро бёдра бедра','batak karabatak'],
 ['крылья крылышки','kril'],['лопатка лопатку','pleck'],['шея шею шейка','vrat'],

 ['piletina pileci pileca pilece','pile pilet'],
 ['ред','red'],['булл бул','bull'],['кола колу','cola kola'],['монстр','monster']
];
shoppingWords.push(['пончик пончики пончиков пончика пончику донат донаты донатов донатс donut donuts doughnut doughnuts donat','donut doughnut krofn donat'],
 ['приправа приправы приправ специи специй','zacin'],
 ['петрушка петрушки петрушку петрушкой parsley','persun parsley'],['укроп укропа укропом dill','mirodj kopar dill'],['кинза кинзы кинзу кориандр кориандра','korijand cilantro'],['базилик базилика basil','bosilj basil'],['розмарин розмарина','ruzmar rosemary'],['тимьян чабрец','timijan majcin'],['мята мяты мяту','menta nana'],['орегано','origano oregano'],['шпинат шпината','spanac spinat'],['руккола рукколу рукколы','rukol rucol'],['сельдерей сельдерея','celer'],['пастернак пастернака','paskan pastrn'],['свёкла свекла свёклу свеклу свеклы','cvekl'],['редис редиска редиску','rotkv'],['тыква тыкву тыквы','bundev tikv'],['брокколи','brokol'],['цветная','karfiol'],['кукуруза кукурузу кукурузы','kukuruz'],['горошек горох гороха','grasak'],['фасоль фасоли','pasulj grah'],['нут нута','leblebij naut'],['чечевица чечевицу чечевицы','sociv'],
 ['персик персики персиков','breskv'],['абрикос абрикосы абрикосов','kajsij'],['нектарин нектарины','nektarin'],['черешня черешню черешни','tresnj'],['вишня вишню вишни','visnj'],['малина малину малины','malin'],['ежевика ежевику','kupin'],['голубика голубику черника чернику','borovnic'],['смородина смородину','ribizl'],['клюква клюкву','brusnic'],['грейпфрут грейпфруты','grejp grapefruit'],['ананас ананасы','ananas'],['манго','mango'],['киви','kivi kiwi'],['гранат гранаты','nar nara'],['дыня дыню дыни','dinj'],['кокос кокоса','kokos coconut'],['инжир инжира','smokv'],['финики фиников','urm datul'],['изюм изюма','suvogrozd suvogrozdje'],['чернослив чернослива','sljiv'],
 ['миндаль миндаля','badem'],['фундук фундука','lesnik'],['фисташки фисташек','pistac'],['кешью','indij'],['семечки семечек','semen semenk'],['кунжут кунжута','susam'],['паприка паприки','paprik'],['корица корицы','cimet'],['куркума куркумы','kurkum'],['имбирь имбиря','djumbir ginger'],['ваниль ванили','vanil'],['сода соды','soda'],['дрожжи дрожжей','kvasac'],['крахмал крахмала','skrob gustin'],['разрыхлитель разрыхлителя','prasak peciv'],['сухари сухарей','prezl dvopek'],
 ['круассан круассаны круассанов','kroasan croissant'],['булочка булочки булочек','zemick peciv'],['бублик бублики','djevrek bagel'],['торт торты торта','torta'],['пирог пироги пирога','pita kolac'],['кекс кексы кекса','mafin muffin kolac'],['маффин маффины','mafin muffin'],['блины блинчики','palacink'],['вафли вафель','vafl'],['пряник пряники пряников','medenjak'],['чипсы чипсов','cips chips'],['попкорн попкорна','kokic popcorn'],['снеки снеков','smok flips gric'],['крекер крекеры крекеров','kreker'],['конфеты конфет','bombon praline'],['мармелад мармелада','zele gumene marmel'],['джем джема варенье варенья','dzem pekmez'],['нутелла','nutella'],['какао','kakao cocoa'],
 ['ряженка','ferment'],['моцарелла моцареллу','mocarel mozzarella'],['пармезан пармезана','parmezan parmesan'],['фета фету','feta'],['сливочный сливочного','krem'],['маргарин маргарина','margarin'],['сгущёнка сгущенка','kondenz zgusn'],['йогурта','jogurt yogurt'],['кефира','kefir'],
 ['форель форели','pastrmk'],['скумбрия скумбрию скумбрии','skus'],['сардины сардин','sardin'],['сельдь селёдка селедка','haring'],['хек хека','oslic'],['креветки креветок','gambor kozic shrimp'],['кальмар кальмары кальмаров','lignj'],['мидии мидий','dagnj'],['осьминог осьминога','hobotnic'],['сёмга семга','losos'],['утка утку утки','patk'],['кролик кролика','kunic zec'],['баранина баранины','jagnj ovc'],['печень печени печёнка печенка','jetr'],['сердце сердечки','src'],['сало сала','slanina'],['рёбра ребра ребрышки','rebr'],['окорок окорока','sunka but'],['голень голени','batak'],['стейк стейки','stejk steak'],['гуляш гуляша','gulas'],['шницель шницели','snicl'],['пельмени пельменей','peljmen raviol'],['равиоли','raviol'],['пицца пиццу пиццы','pizz'],['суп супы супа','supa corba'],
 ['шампиньоны шампиньонов','sampinjon'],['грибы грибов','pecurk gljiv sampinjon'],['вешенки вешенок','bukovac'],['маслины маслин оливки оливок','maslin'],['каперсы каперсов','kapar'],['хумус хумуса','humus hummus'],['тахини','tahini taan'],['горчица горчицу горчицы','senf'],['уксус уксуса','sirce ocat'],['хрен хрена','ren hren'],['аджика айвар айвара','ajvar'],['песто pesto','pesto'],['барбекю','barbecue bbq'],['соевый соевого','soja sojin'],
 ['крупа крупы','pirinac heljd proso bulgur kuskus kinoa jecam griz ovsen krupica'],['пшено пшена','proso'],['булгур булгура','bulgur'],['кускус кускуса','kuskus couscous'],['киноа','kinoa quinoa'],['перловка перловку','jecam'],['манка манку манная','griz'],['мюсли мюслей','musli muesli'],['гранола гранолы','granola'],['овсяное овсяный','ovsen'],['ржаной ржаного','razeni razan'],['пшеничный пшеничная','psenic'],['цельнозерновой цельнозерновые','integral'],
 ['кола cola','cola kola'],['лимонад лимонада','limunad lemonad'],['тоник тоника','tonic tonik'],['квас кваса','kvas'],['сидр сидра','cider sajder'],['виски','whisky whiskey'],['водка водки','vodka votka'],['ром рома','rum'],['джин джина','gin dzin'],['текила текилы','tequila tekila'],['ликёр ликер ликера','liker liqueur'],['коньяк коньяка','konjak cognac'],['ракия ракию ракии','rakij'],
 ['средство средства','sredstv'],['посудомойка посудомойки','sudomasin'],['кондиционер кондиционера','omeksiv regenerator'],['отбеливатель отбеливателя','izbeljiv belil'],['пятновыводитель пятновыводителя','fleke'],['перчатки перчаток','rukavic'],['фольга фольги','folij'],['плёнка пленка пленки','folij'],['пергамент пергамента','papir pecenj'],['полотенца полотенец','ubrus peskir'],['щётка щетка щетки щётки','cetk'],['расчёска расческа расчески','cesalj'],['бритва бритву бритвы','brijac'],['прокладки прокладок','ulosci'],['тампоны тампонов','tampon'],['дезодорант дезодоранты','dezodor dezodorans'],['антиперспирант','antiperspir'],['гель геля','gel'],['крем крема','krem'],['лосьон лосьона','losion'],['бальзам бальзама','balzam'],['зубы зубов','zub'],['ополаскиватель ополаскивателя','vodic tecnost'],['линзы линз','sociv'],['подгузник подгузников','pelen'],['пелёнки пеленки пеленок','pelen podlog'],
 ['розетка розетки','uticnic'],['выключатель выключателя','prekidac'],['удлинитель удлинителя','produzn'],['отвёртка отвертка отвертки','odvijac srafciger'],['дрель дрели','busilic'],['шуруповёрт шуруповерт','busilic odvijac'],['молоток молотка','cekic'],['гвозди гвоздей','ekser'],['шуруп шурупы саморез саморезы','sraf vijak'],['плоскогубцы пассатижи','klest'],['нож ножи ножей','noz'],['ножницы ножниц','makaz'],['рулетка рулетки','metar'],['клей клея','lepak ljepilo'],['скотч скотча','trak'],['краска краски','boj farb'],['кисть кисти кисточка','cetk'],['валик валики','valjak'],['шпатель шпателя','spahtl'],['наждачка наждачная','smirgl'],['пила пилы','testera'],
 ['кастрюля кастрюлю кастрюли','serp lonac'],['сковорода сковороду сковородки','tiganj'],['тарелка тарелки тарелку','tanjir'],['миска миски миску','cinij'],['чашка чашки кружка кружки','solj'],['стакан стаканы стакана','casa case'],['ложка ложки ложку','kasik'],['вилка вилки вилку','viljusk'],['чайник чайники чайника','kuval cajnik'],['блендер блендера','blender'],['миксер миксера','mikser'],['тостер тостера','toster'],['утюг утюга','pegl'],['пылесос пылесоса','usisivac'],['весы весов','vaga'],['вентилятор вентилятора','ventilator'],['обогреватель обогревателя','grejalic'],['шланг шланга','crevo'],['ведро ведра','kant kofa'],['швабра швабры','brisac mop'],['веник веника','metla'],['тряпка тряпки','krpa'],['коврик коврика','otirac prostirk'],['подушка подушки','jastuk'],['одеяло одеяла','ceb jorgan'],['простыня простыни','carsav'],['полка полки полку','polic'],['стул стулья стула','stolic'],['стол столы стола','sto stol'],['горшок горшка горшки','saksij'],['семена семян','seme sjeme'],['удобрение удобрения','djubriv'],['земля землю земли','zemlj supstrat']);
// Reviewed spelling variants only: no fuzzy widening of brands or barcodes.
const extraForms={огурец:'огурчик огурчики огурчиков огурцом',помидор:'помидорки томата томатов помидорами',морковь:'моркови морковку',энергетик:'енергетик энергитик энеретик энергетиk',пончик:'крофна крофне krofna krofne крофни',петрушка:'першун першунь першин пертушка',кофе:'коффе кофe',шампуни:'шампуней шампунью',сметана:'сметаны сметанка',сливки:'сливочки',салфетки:'салфетку салфетками',колбаса:'колбаски колбасок',сосиски:'сосиска сосиску',макарон:'макарошки',зелень:'зелени'};
shoppingWords.push(['зелень','persun mirodj kopar korijand bosilj rukol']);
for(const row of shoppingWords){const more=extraForms[row[0].split(' ')[0]];if(more)row[0]+=' '+more;}
shoppingWords.push(['редбулл редбул redbull','redbull'],['монстер манстер','monster']);
shoppingWords.push(['треска треску трески','bakalar'],['карп карпа','saran'],['судак судака','smudj'],['сом сома','som'],['сибас сибаса','brancin'],['дорадо дорада','orada'],['пангасиус пангасиуса','pangasius pangaz'],['тилапия тилапию тилапии','tilapi'],['анчоус анчоусы анчоусов','incun'],['морепродукты морепродуктов','gambor kozic shrimp lignj dagnj hobotnic']);
export const shoppingLexicon=()=>[...Object.entries(words).map(([query,terms])=>({query,forms:[query],terms})),...shoppingWords.map(([forms,terms])=>({query:forms.split(' ')[0],forms:forms.split(' '),terms:terms.split(' ')}))];
const phrases=[
 ['сухое молоко','молоко prah'],['молоко в порошке','молоко prah'],['сгущённое молоко','молоко kondenz'],['сгущенное молоко','молоко kondenz'],['питьевое молоко','молоко'],['обычное молоко','молоко'],['кисломолочное молоко','молоко kisel'],['шоколадное молоко','молоко cokolad'],
 ['наждачка','brusni papir'],['наждачная бумага','brusni papir'],['шлифовальная бумага','brusni papir'],['наждачная','brusni papir'],
 ['изюм','suvo grozdje'],['изюма','suvo grozdje'],['цветная капуста','karfiol'],['белый хлеб','beli hleb'],['зелёный лук','mladi luk'],['зеленый лук','mladi luk'],['лавровый лист','lovor'],['грецкий орех','orah'],['грецкие орехи','orah'],
 ['соус песто','pesto'],['соуса песто','pesto'],
 ['кофе в зернах','kafa zrn'],['кофе в зёрнах','kafa zrn'],['кофе в капсулах','kafa kapsul'],
 ['сливочное масло','maslac'],['сливочного масла','maslac'],
 ['подсолнечное масло','suncokret ulje'],['подсолнечного масла','suncokret ulje'],
 ['оливковое масло','maslin ulje'],['оливкового масла','maslin ulje'],
 ['минеральная вода','mineral voda'],['минеральной воды','mineral voda'],
 ['газированная вода','gaziran voda'],['газированной воды','gaziran voda'],
 ['зубная паста','pasta zub'],['зубную пасту','pasta zub'],
 ['влажные салфетки','vlazn maramic'],['влажных салфеток','vlazn maramic'],
 ['корм для кошек','hrana mack'],['корм для котов','hrana mack'],['корм для собак','hrana ps']
].flatMap(([from,to])=>{const tokens=normalize(from).split(' '),target=normalize(to);return tokens.length===2?[[tokens.join(' '),target],[[...tokens].reverse().join(' '),target]]:[[tokens.join(' '),target]];});
const aliases=Object.fromEntries([...Object.entries(words),...shoppingWords.flatMap(([forms,terms])=>forms.split(' ').map(form=>[form,terms.split(' ')]))].map(([key,value])=>[normalize(key),value]));
// Ambiguous stems need reviewed word forms, not an unrestricted prefix.
// riba (fish) must not match ribanac/ribanje (grated cabbage/scrubbing).
const boundedTerms={
 riba:{words:'riba ribe ribu ribom'},som:{words:'som soma somu somom'},saran:{words:'saran sarana saranu saranom'},
 sir:{words:'sir sira sirom siru sirevi sireva sireve',prefixes:'sirn sirev'},
 luk:{words:'luk luka luku lukom lukovi lukova'},med:{words:'med meda medom medu'},
 caj:{words:'caj caja caju cajem cajevi cajeva cajeve'},sos:{words:'sos sosa sosu sosom sosevi soseva soseve'},
 voda:{words:'voda vode vodu vodom'},
 soli:{words:'soli'},jaja:{words:'jaja jajima'},jaje:{words:'jaje jajeta jajetom'},
 nar:{words:'nar nara naru narom'},nara:{words:'nara'},zele:{words:'zele zelea zeleu zeleom'},
 pic:{words:'pice picem picu'},gel:{words:'gel gela gelom gelu gelovi gelove'},
 sunk:{words:'sunka sunke sunku sunkom',prefixes:'sunkaric'},
 prs:{words:'prsa prsi prsima prsni prsna prsne'},grud:{words:'grudi grudima grudni grudna'},
 vrat:{words:'vrat vratu vratom'},rebr:{words:'rebra rebro rebara rebrima'},
 sto:{words:'sto stola stolu stolom stolovi stolova stolove',prefixes:'stocic'},
 stol:{words:'stola stolu stolom stolovi stolova stolove'},
 sraf:{words:'sraf srafa srafu srafom srafovi srafova srafove'},
 noz:{words:'noz noza nozu nozem nozevi nozeva nozeve nozic'},
 solj:{words:'solja solje solju soljom solji',prefixes:'soljic'},serp:{words:'serpa serpe serpi serpu serpom'},
 zub:{words:'zub zuba zube zubi zubom',prefixes:'zubn'},
 boj:{words:'boja boje boju boji bojom'},
 trak:{words:'traka trake traku trakom trakama trakica trakice'},
 casa:{words:'casa case casu casom casama'},case:{words:'case'},
 kant:{words:'kanta kante kantu kantom kanti',prefixes:'kantic'},
 ceb:{words:'cebe cebeta cebetom cebadi'},
 krem:{words:'krem krema kreme kremu kremom kremi kremovi kremova kremove',prefixes:'kremast'}
};
const reviewedPatterns=Object.fromEntries(Object.entries(boundedTerms).map(([root,rule])=>[root,[...(rule.words||'').split(' ').filter(Boolean).map(term=>({term,exact:true})),...(rule.prefixes||'').split(' ').filter(Boolean).map(term=>({term,exact:false}))]]));
const exactTerms=new Set(['so','sok','cola','kola','pivo','vino','kvas','ren','hren','rum','gin']);
export function searchPatterns(term){return Object.hasOwn(reviewedPatterns,term)?reviewedPatterns[term]:[{term,exact:exactTerms.has(term)||/^(?:e\d+|gu\d+|g\d+|\d+(?:w|lm|k|kg|g|ml|l)|\d{8,14})$/.test(term)}];}
export const matchesSearchTerm=(word,term)=>searchPatterns(term).some(p=>p.exact?word===p.term:word.startsWith(p.term));
const energyTokens=new Set(shoppingWords.find(([forms])=>forms.startsWith('энергетик '))[0].split(' ').map(normalize));
export const energyQuery=query=>normalize(query).split(' ').some(t=>energyTokens.has(t));
export function volumeQuery(query){
 let match=String(query).match(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(ml|мл|cl|l|л)(?![\p{L}\p{N}])/iu);
 if(!match&&energyQuery(query)){const decimal=String(query).match(/(?<![\p{L}\p{N}.,])([012][.,]\d{1,3})(?![\p{L}\p{N}.,])/u);if(decimal){const ml=Number(decimal[1].replace(',','.'))*1000;if(ml>=50&&ml<=2000)match=[decimal[0],decimal[1],'l'];}}
 if(!match)return null;
 const factor=/^(ml|мл)$/i.test(match[2])?1:/^cl$/i.test(match[2])?10:1000,ml=Number(match[1].replace(',','.'))*factor;
 if(!Number.isInteger(ml)||ml<1||ml>10000)return null;
 const liters=String(ml/1000),centiliters=String(ml/10),forms=[ml+'ml',liters+'l',centiliters+'cl'];
 return {text:match[0],ml,forms,terms:[...new Set(forms.map(x=>normalize(x).split(' ').at(-1)))]};
}
export function weightQuery(query){
 const match=String(query).match(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(kg|кг|gr|гр|g|г)(?![\p{L}\p{N}])/iu);if(!match)return null;
 const grams=Number(match[1].replace(',','.'))*(/^(kg|кг)$/i.test(match[2])?1000:1);if(!Number.isInteger(grams)||grams<1||grams>100000)return null;
 const forms=[grams+'g',grams+'gr',grams+'гр',(grams/1000)+'kg'];return {text:match[0],grams,forms,terms:[...new Set(forms.map(x=>normalize(x).split(' ').at(-1)))]};
}
export function queryGroups(query){
 const original=String(query),volume=volumeQuery(query)||weightQuery(query);let translated=' '+normalize(volume?original.replace(volume.text,' '):query)+' ';
 for(const [from,to] of phrases)translated=translated.replaceAll(' '+from+' ',' '+to+' ');
 const tokens=translated.trim().split(' ').filter(Boolean);
 requireValue(tokens.length>0&&tokens.length<=8&&original.length<=120,'Введите название короче 120 символов.');
 const brandText=tokens.map(t=>(aliases[t]?.length===1?aliases[t][0]:t)).join(' '),redBull=/(?:^| )red ?bull?(?: |$)/.test(brandText);
 const energy=energyQuery(query),specificEnergy=redBull||energy&&/(?:^| )(?:monster|guarana|hell|ultra)(?: |$)/.test(brandText),groups=[];
 for(const token of tokens){
  if(specificEnergy&&energyTokens.has(token))continue;
  if(['свежий','свежие','свежая','свежую','сырое','сырая','сырой','sveza','sveze','svezi','raw'].map(normalize).includes(token)&&tokens.some(t=>(aliases[t]||[t]).some(w=>/^(krastav|paradajz|rajcic|pile|pilet|goved|junec|svinj|curet)/.test(w))))continue;
  if(energy&&['напиток','напитки','напитка'].map(normalize).includes(token))continue;
  if(redBull&&['redbull','редбулл','редбул'].map(normalize).includes(token)){groups.push(['red','redbull'],['bull','redbull']);continue;}
  const group=aliases[token]||[token];
  if(group.length===2&&group.includes('prasak')&&group.includes('peciv')){groups.push(['prasak'],['peciv']);continue;}
  if(group.length===2&&group.includes('papir')&&group.includes('pecenj')){groups.push(['papir'],['pecenj']);continue;}
  if(group.length===1&&group[0]==='indij'){groups.push(['indij'],['orah','orascic']);continue;}
  if(['линзы','линз'].map(normalize).includes(token)){groups.push(['kontakt','contact'],['sociv','lens']);continue;}
  if(group.includes('beli')&&group.includes('cesnjak')){groups.push(['beli','cesnjak'],['luk','cesnjak']);continue;}
  if(['фарш','фарша'].map(normalize).includes(token)){groups.push(group,['mes','junec','goved','svinj','pile','curet']);continue;}
  groups.push(redBull&&group.some(t=>t==='red'||t==='bull')?[...group,'redbull']:group);
 }
 if(volume)groups.push(volume.terms);
 return groups;
}
const fishRoots=new Set('riba riblj losos salmon tunjevin tuna pastrm pastrmk skus sardin haring oslic bakalar brancin orada smudj saran som pangasius pangaz tilapi incun papalin giric gambor kozic shrimp lignj dagnj hobotnic'.split(' '));
const foodRoots=new Set(('krastav paradajz rajcic krompir sargarep luk beli kupus jabuk banan pomorand limun krusk jagod grozd lubenic sljiv jaja jaje pile pilet meso goved junec svinj curet mleko mlijeko sir maslac kafa caj secer brasno hleb voda pirinac so soli med ulje keks biskvit cokolad sok pivo vino persun parsley mirodj kopar korijand bosilj spanac celer cvekl rotkv brokol karfiol kukuruz grasak pasulj leblebij sociv breskv kajsij tresnj visnj malin borovnic badem lesnik pistac kikiriki orah orascic krofn donut doughnut donat peciv kobasic salam senf kecap majonez pesto dzem pekmez griz ovs musli nar nara zele jagnj ovc patk kunic zec jetr src rebr grud prs heljd proso bulgur kuskus kinoa jecam krupica napit pic drink '+[...fishRoots].join(' ')).split(' '));
for(const root of 'krumpir mrkv tikvic patlidzan paprik salat mandarin avokad nektarin kupin ribizl brusnic grejp grapefruit ananas mango kivi kiwi dinj kokos coconut smokv urm datul suvogrozd suvogrozdje indij semen semenk susam cimet kurkum djumbir ginger vanil kvasac skrob gustin prezl dvopek kroasan croissant zemick djevrek bagel torta pita kolac mafin muffin palacink vafl medenjak cips chips kokic popcorn smok flips gric kreker bombon praline marmel nutella kakao cocoa ferment mocarel mozzarella parmezan parmesan feta margarin kondenz zgusn sunka sunk slanin bacon rebr batak stejk steak gulas snicl peljmen raviol pizz supa corba bukovac maslin kapar humus hummus tahini taan sirce ocat ren hren ajvar barbecue bbq soja sojin riza testenin pasta spaget ovs ovsen zob pahulj muesli granola limunad lemonad tonic tonik cider sajder whisky whiskey vodka votka rum gin dzin tequila tekila liker liqueur konjak cognac rakij'.split(' '))foodRoots.add(root);
// This reviewed official dataset contains hardware/home goods, not groceries.
// Food searches must not rank a meat slicer or salt cellar as the food itself.
// The source stays enabled for all nonfood searches; revisit if its range changes.
export const nonGrocerySources=['69f46178dc8b5354213e7c52']; // pragma: allowlist secret
const nonfoodRoots=new Set('sapun sampon gel losion krem balzam regenerator solj tanjir noz kasik ser postelj cetk hrana igrack kalup aparat sijalic zarulj lamp kitekat whiskas pedigree friskies dog cat motor kontakt zub posud cinij tiganj lonac lonc serp drzac viljusk pekac strugac lopatic dask klest resetk termomet radijator grejalic podlosk cekic testera hvatalj kuval tajmer svec separator rezac dozer mesoreznic mlin papir folij'.split(' '));
for(const root of 'virsl hrenov jogurt yogurt kefir pavlak vrhnj sladoled sokic pecen svinj curet goved'.split(' '))foodRoots.add(root);
const categoryIndex=roots=>{const index=new Map();for(const root of roots)for(const p of [{term:root,exact:true},...searchPatterns(root)]){if(!index.has(p.term[0]))index.set(p.term[0],[]);index.get(p.term[0]).push(p);}return index;};
const nonfoodPatterns=categoryIndex(nonfoodRoots),foodPatterns=categoryIndex(foodRoots),fishPatterns=categoryIndex(fishRoots);
const categoryMatches=(groups,index)=>groups.some(g=>g.some(t=>(index.get(t[0])||[]).some(p=>p.exact?t===p.term:t.startsWith(p.term))));
export const groceryQuery=query=>{const groups=queryGroups(query);return !categoryMatches(groups,nonfoodPatterns)&&categoryMatches(groups,foodPatterns);};
export const fishQuery=query=>groceryQuery(query)&&categoryMatches(queryGroups(query),fishPatterns);
export const breastQuery=query=>queryGroups(query).some(g=>g.includes('grud')&&g.includes('prs'));
export const donutQuery=query=>queryGroups(query).some(g=>g.some(t=>/^(donut|doughnut|krofn|donat)/.test(t)))&&!/(?:^| )(?:voda|water|mg|solja|solje|kalup|aparat|plafonjerka)(?: |$)/.test(normalize(query))&&!/вода|кружк|форма|аппарат|светильник/.test(String(query).toLowerCase());
export const parsleyQuery=query=>queryGroups(query).some(g=>g.some(t=>/^persun|^parsley/.test(t)))&&!/(сыр|приправа|суп|sir|supa|zacin)/i.test(query);
export const plumQuery=query=>!volumeQuery(query)&&queryGroups(query).some(group=>group.some(word=>/^sljiv/.test(word)))&&!/(?:^| )(?:rakij[a-z]*|sljivovic[a-z]*|paradajz|rajcic[a-z]*|dzem|pekmez|peciv[a-z]*|rolnic[a-z]*|pita|burek|kroas[a-z]*|lisnat[a-z]*|strudl[a-z]*|kolac[a-z]*|marmel[a-z]*|slatko|arom[a-z]*|kasic[a-z]*|kasa|sok|caj|knedl[a-z]*|cokolad[a-z]*)(?: |$)/.test(normalize(query))&&!/раки|сливовиц|томат|помидор|джем|варень|каша|пюре|сок|чай|шоколад/i.test(String(query));
export const plainMilkQuery=query=>/(?:^|\s)(?:питьевое|обычное)(?:\s|$)/i.test(query)&&/(молок)/i.test(query);
export const milkQuery=query=>queryGroups(query).some(group=>group.some(word=>/^(mleko|mlijeko)$/.test(word)))&&!/(?:^| )(?:posud[a-z]*|lon[a-z]*|aparat[a-z]*|sapun|losion|telo|tijelo|ciscenj[a-z]*|sampon|kupk[a-z]*)(?: |$)/.test(normalize(query))&&!/посуд|кастрюл|кувшин|аппарат|мыло|лосьон|очищ|тела|шампунь/i.test(String(query));
export const pestoQuery=query=>queryGroups(query).some(group=>group.includes('pesto'))&&!/(?:^| )(?:sir|pastet[a-z]*|rolnic[a-z]*|humus|hummus)(?: |$)/.test(normalize(query))&&!/сыр|паштет|рулет|хумус/i.test(String(query));
export const freshProduceQuery=query=>!/(марин|сол[её]н|консерв|паста|соус|суп|сок|сметан|kisel|marin|paster|konzerv)/i.test(String(query))&&!/(kisel|marin|paster|konzerv|pasta|sos|supa|sok|pavl|perec)/.test(normalize(query))&&queryGroups(query).some(group=>group.some(word=>/^(krastav|paradajz|rajcic)/.test(word)));
export const relatedChickenQuery=query=>!/(корм|hrana|whiskas|kitekat|pedigree)/i.test(String(query))&&queryGroups(query).some(g=>g.length<=2&&g.some(t=>/^(pile|pilet)/.test(t)));
export const freshMeatQuery=query=>(!relatedChickenQuery(query)||/(свеж|сырой|сырая|сырое|svez|svjez|raw)/i.test(String(query)))&&!/(фарш|паштет|колбас|сосиск|копч|готов|суп|соус|корм)/i.test(String(query))&&!/(pastet|kobasic|salam|virsl|dimlj|supa|sos|hrana|mleven|mljeven|gril|rostilj|pecen|pohov|panir|kubet|smok|smaz|kitekat|patelin|fryer|sampinjon|deligh|dog|cat)/.test(normalize(query))&&queryGroups(query).some(group=>group.some(word=>/^(pile|goved|junec|svinj|curet)/.test(word)));
export const butterQuery=query=>queryGroups(query).some(group=>group.length===1&&group[0]==='maslac')&&!/(posud|noz|keks|biskvit|kikirik|kakao|pasta|kokic|popcorn|baget|peciv|kroasan|marg)/.test(normalize(query));
export const oilQuery=query=>queryGroups(query).some(group=>group.length===1&&group[0]==='ulje')&&!/(motor|menjac|sapun|sampon|tun|sardin|grisin|riba|sos|pasta)/.test(normalize(query));
export const bulbQuery=query=>queryGroups(query).some(group=>group.some(word=>/^sijalic|^zarulj|^bulbs?$/.test(word)));
// Catalogue units describe categories in several feeds, not the sale basis.
// Derive a comparable unit price only from an unambiguous title quantity.
export function rawPackageMeasure(name){
 const text=String(name),pattern=/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(kg|кг|ml|мл|cl|gr|гр|g|г|l|л)(?![\p{L}\p{N}])/giu;
 if(/\+\s*\d/.test(text))return null;
 const multi=text.match(/(?<![\p{L}\p{N}])(\d{1,3})\s*[xх×*]\s*(\d+(?:[.,]\d+)?)\s*(kg|кг|ml|мл|cl|gr|гр|g|г|l|л)(?![\p{L}\p{N}])/iu)||text.match(/(?<![\p{L}\p{N}.,])(\d+(?:[.,]\d+)?)\s*(kg|кг|ml|мл|cl|gr|гр|g|г|l|л)\s*[xх×*]\s*(\d{1,3})(?!\d)/iu);
 let multiplier=1,base=text;
 if(multi){const reverse=/^[0-9.,]+\s*(?:kg|кг|ml|мл|cl|gr|гр|g|г|l|л)\s*[xх×*]/iu.test(multi[0]);multiplier=Number(reverse?multi[3]:multi[1]);if(multiplier<1||multiplier>100)return null;const value=reverse?multi[1]:multi[2],unit=reverse?multi[2]:multi[3];base=text.replace(multi[0],value+unit);}
 const values=[...base.matchAll(pattern)].map(m=>{const unit=m[2].toLowerCase(),weight=/^(kg|кг|gr|гр|g|г)$/.test(unit),amount=Number(m[1].replace(',','.'))*(/^(kg|кг|l|л)$/.test(unit)?1000:unit==='cl'?10:1);return {kind:weight?'weight':'volume',amount};});
 if(!values.length||values.some(v=>v.kind!==values[0].kind||v.amount!==values[0].amount))return null;
 const result={...values[0],amount:values[0].amount*multiplier};
 if(!Number.isSafeInteger(result.amount)||result.amount<=0||result.amount>1000000)return null;
 return result;
}
// Source fields often contain category units; a title can also contain capacity,
// load limits or a mistyped dimension. Never convert weight into volume.
// Only fixed, code-owned patterns enter this cache. QuickJS otherwise recompiles
// long category expressions for every public catalogue row.
const measurePatterns=new Map();
const measurePattern=(text,exact=false)=>{const key=(exact?'e:':'p:')+text;if(!measurePatterns.has(key))measurePatterns.set(key,new RegExp('(?:^| )(?:'+text+')'+(exact?'':'[a-z0-9]*')+'(?: |$)'));return measurePatterns.get(key);};
export function measurePolicy(name){
 const t=normalize(name),ru=String(name).toLowerCase();
 const has=roots=>measurePattern(roots).test(t);
 const exact=words=>measurePattern(words,true).test(t);
 const head=t.replace(/^(?:[0-9]+ )?[0-9]+(?:ml|l|cl|kg|gr|g) /,'');
 const contents=/^(?:sredstvo |sred |sprej |silikon |mast |lepak |lepilo |boja |lak |ulje |tecnost |pasta |sampon |sapun |deterdzent |pena |mleko |jogurt |kefir |sok |voda |vino |rakija |pivo |keks |cokolad|med |kafa |dzem |pekmez |so )/.test(head);
 // Identify the main object, not a container mentioned after a food or cleaner.
 // Repeated prefixes cover sets, materials, dimensions and appliance adjectives.
 const object=head.replace(/^(?:[0-9]+ )+/,'').replace(/^(?:(?:garn|gar|garnitura|set|dubok[a-z]*|plitk[a-z]*|pvc|inox|staklen[a-z]*|plasticn[a-z]*|metaln[a-z]*|keramic[a-z]*|porcelan[a-z]*|decij[a-z]*|termo|vatrost[a-z]*|ugradn[a-z]*|elektric[a-z]*|rucn[a-z]*|digitaln[a-z]*|kuhinjsk[a-z]*|bravar[a-z]*|ekspres|el|smart) )+/,'');
 if(/[0-9]\s*(?:g|gr|г)\s*\/\s*(?:m[²2]|м[²2])/iu.test(String(name)))return 'piece';
 if(/kasika ljubavi/.test(t))return 'either';
 if(/^(?:solj|(?:casa|case)(?= |$)|flas|boc|termos|lonac|lonc|posud|serp|tiganj|kant(?:a|e|u)(?= |$)|kofa|saksij|kalup|kutij|aparat|kuval|frizider|zamrzivac|sporet|rerna|usisivac|vesmasin|masina|mikser|blender|toster|noz|kasik|viljusk|tanjir|makaz|odvijac|cekic|busilic|merdevin|laptop|memorij|telefon|top za punjenje|bojler|vaga|korpa|dozer|dozator|cinij|tegl|prskal|akvarijum|kanister|bokal|ranac|ruksak|torba|rezervoar)/.test(object))return 'piece';
 if(!contents&&(has('majic|pantalon|tregeric|jakn|dukseric|prsluk|trenerk|bluz|peskir|cebe|prekrivac|jorgan|posteljin|carsav|jastuk|bojler|vaga(?= |$)|vage(?= |$)|opterec|kapacitet|nosivost|sijalic|zarulj|plafonjer|baterij')||exact('sef')||has('frizider')||has('kes[ae]|dzak')&&has('smec|djub|dj(?= |$)|zamrz|zipper|otpad')||has('prskalic')&&/[0-9]+cm/.test(t)))return 'piece';
 if(/лампоч|батарей|кастрюл|сковород|чайник|бутыл|кружк|стакан|ведро|горшок|пылесос|ноутбук|телефон|бойлер|весы|нагрузк|фритюрниц|кувшин|термос|рюкзак|футболк|куртк|брюк|полотенц/.test(ru))return 'piece';
 if(exact('donat mg'))return 'volume';
 // Both units are legitimate for these forms. Ingredients and flavour words
 // cannot establish the physical form of a product, so uncertain titles stay open.
 if(has('sladoled|icecream|med|honey|jogurt|yogurt|kefir|pavlak|krem|sapun|sampon|gel|balzam|prah|prasak|instant|kapsul|supa|corba|kisel|kondenz|evapor|suvo|susen|latte|cappucc|kapuc|ledena|iced|sos|sirup|sredstv|deterdz|pranj|namaz|cedevita|ciobar|nesquik|milkshake|sejk|ice(?= |$)|kras express|bebe|bebelac|humana|optipro|nutrino|kokos|piling|flasice|mix|crem|arom|protein|vitamin|kakao|hipp|combiotic|odoj|formul|barista|shake|tuna|tunjevin|skus|incun|pasta|zamena|dodatak|kafu|barni|napolit|stapic|karamel')||exact('kis|pra|kap')||/сухое|сухого|сгущ[её]н|кисломолоч|кислое|морожен|м[её]д|йогурт|кефир|сметан|мыло|шампун|гель|порош|растворим|капсул|суп/.test(ru))return 'either';
 const solid=has('donut|donat|doughnut|krofn|hleb|kruh|baget|keks|biskvit|cips|chips|kolac|torta|mafin|kroasan|peciv|pilet|pilec|goved|junec|svinj|curet|meso|kobasic|salam|virsl|jetr|persun|brasno|pirinac|testenin|maslac|bombon|pralin|smoki|focacc')||/пончик|петруш|хлеб|печенье|чипс|куриц|говядин|свинин|мясо|колбас|мука/.test(ru);
 const drink=exact('napitak|napitci|drink|drinks|voda|water|sok|juice|pivo|beer|vino|wine|ulje|sirce|mleko|mlijeko|cola|kola')||has('rakij|vodka|votka|whisky|whiskey|tequila|tekila|liker|limunad|lemonad|cider|sajder|somersby')||has('energet|energ(?= |$)|energy')&&has('napitak|pice|drink')||/энергетик|напиток|молоко|лимонад|пиво|вино/.test(ru);
 if(exact('sok')&&has('paradajz'))return 'either';
 if(drink&&solid)return 'either';
 if(drink)return /^(?:энергетик|напиток|молоко)/.test(ru)||/^(?:napitak |drink |voda |water |sok |juice |pivo |beer |vino |wine |mleko |mlijeko |ulje |cola |kola |red bull |redbull |energetik|energetsk|napitok|moloko)/.test(head)||has('energet|energy')&&has('napitak|pice|drink')?'volume':'either';
 if(solid||/^(?:secer |so |soli |kafa |coffee )/.test(head)||/сахар|кофе/.test(ru))return 'weight';
 return 'either';
}
export function measurementIssue(name){
 const raw=rawPackageMeasure(name);if(!raw)return null;
 const policy=measurePolicy(name);
 return policy==='piece'?'capacity_or_specification':policy!=='either'&&policy!==raw.kind?'wrong_dimension':null;
}
export function packageMeasure(name){
 return measurementIssue(name)?null:rawPackageMeasure(name);
}
// Keep a validated quantity beside the original title. It lets SQL compare
// complete multipacks without guessing from a unit substring or source field.
export const MEASURE_VERSION=3;
export function measuredOffer(offer){
 const pack=packageMeasure(offer.name),n=pack?.amount,forms=!pack?[]:pack.kind==='volume'?[n+'ml',(n/1000)+'l',(n/10)+'cl']:[n+'g',n+'gr',(n/1000)+'kg'];
 return {...offer,_measure:pack,_measure_rev:MEASURE_VERSION,terms:[...new Set([...(offer.terms||[]),...forms.flatMap(f=>normalize(f).split(' '))])]};
}
// Bounded aggregate over public catalogue data; no user input or identity.
export const emptyQuality=()=>({offers:0,measurable:0,wrong_dimension:0,specifications:0,metadata_conflicts:0,price_compared:0,price_jumps:0,examples:[]});
export function auditOffer(quality,offer,previous=null){
 quality.offers++;const raw=rawPackageMeasure(offer.name),issue=measurementIssue(offer.name),pack=issue?null:raw;
 if(pack)quality.measurable++;
 if(issue==='wrong_dimension')quality.wrong_dimension++;
 if(issue==='capacity_or_specification')quality.specifications++;
 const unit=normalize(offer.unit||''),dimension=/^(l|lit|ml|cl|litar|litara)$/.test(unit)?'volume':/^(kg|g|gr|kilogram)$/.test(unit)?'weight':null;
 if(raw&&dimension&&raw.kind!==dimension)quality.metadata_conflicts++;
 const comparable=previous?.name===offer.name&&Number.isSafeInteger(previous.regular)&&previous.regular>0;
 const jump=comparable&&(offer.regular>=previous.regular*3||offer.regular*3<=previous.regular);
 if(comparable)quality.price_compared++;if(jump)quality.price_jumps++;
 if((issue==='wrong_dimension'||jump)&&quality.examples.length<6)quality.examples.push({kind:jump?'price_jump':'dimension',name:String(offer.name).slice(0,120)});
 return quality;
}
export function unitPrice(offer,price=currentPrice(offer)){
 const title=normalize(offer.name);if(/^(?:solj|casa|case|flasa|termos|lonac|lonc|posud|serp|tiganj|kanta|kante|kantu|kofa|saksij|aparat|kuval|kalup|kutij)/.test(title)||/(?:^| )(?:sijalica|plafonjerka|igracka|saksija|termos)(?: |$)/.test(title))return null;
 const pack=packageMeasure(offer.name);if(!pack||!Number.isSafeInteger(price)||!Number.isSafeInteger(price*1000)||price<=0)return null;
 const amount=Math.round(price*1000/pack.amount);if(!Number.isSafeInteger(amount)||amount<=0)return null;
 return {price:amount,unit:pack.kind==='weight'?'кг':'л',label:money(amount)+'/'+(pack.kind==='weight'?'кг':'л')};
}
export function day(now=Date.now()){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Belgrade',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now);const get=k=>parts.find(x=>x.type===k).value;return get('year')+'-'+get('month')+'-'+get('day');}
export const cutoff=now=>new Date(Date.parse(day(now)+'T12:00:00Z')-2*86400000).toISOString().slice(0,10);
export function currentPrice(offer,today=day()){return offer.discount&&offer.begin<=today&&((offer.end&&offer.end>=today)||(!offer.end&&offer.date===today))?offer.discount:offer.regular;}
export const money=cents=>(cents/100).toLocaleString('ru-RU',{minimumFractionDigits:2,maximumFractionDigits:2})+' RSD';
export async function assertBot(api){const bot=await api.getMe();requireValue(bot?.username===BOT_USERNAME&&positive(bot.id),'Wrong bot identity; stopped before accessing data');return bot;}
