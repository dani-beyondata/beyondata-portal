with params as (select '7808b663-735b-46ab-b4ae-80ec4c14c61a'::uuid cid),
n_agg as (
  select extract(year from n.stay_date)::int y, extract(month from n.stay_date)::int m,
         sum(n.price) prod_acc,
         sum(case when n.bed_code_raw is null or n.bed_code_raw='' then r.beds_per_room else 1 end) bednights,
         count(distinct n.reservation_uid) reservas
  from nights n left join rooms r on r.company_id=n.company_id and r.raw_value=n.room_code_raw
  where n.company_id=(select cid from params) group by 1,2),
cap_agg as (
  select extract(year from rcc.date)::int y, extract(month from rcc.date)::int m, sum(r.beds_per_room) capacity
  from room_capacity_calendar rcc join rooms r on r.id=rcc.room_id
  where rcc.company_id=(select cid from params) and rcc.status='open' group by 1,2),
ext_agg as (
  select extract(year from rd)::int y, extract(month from rd)::int m, sum(amt) prod_extras from (
    select (case when c.revenue_timing='at_checkout' then rr.date_check_out else rr.date_check_in end) rd,
           e.units*c.unit_price_gross amt
    from extras e join extras_catalog c on c.company_id=e.company_id and c.raw_value=e.raw_value
    left join reservations rr on rr.company_id=e.company_id and rr.reservation_uid=e.reservation_uid
    where e.company_id=(select cid from params) and not coalesce(c.is_passthrough,false)) z group by 1,2),
mv as (
  select cap.y, cap.m, coalesce(n.prod_acc,0) prod_acc, coalesce(n.bednights,0) bednights,
     cap.capacity, coalesce(n.reservas,0) reservas, coalesce(ex.prod_extras,0) prod_extras
  from cap_agg cap left join n_agg n using (y,m) left join ext_agg ex using (y,m)),
yr as (select * from mv where y=$CY),
ytot as (select sum(bednights) bn_y, sum(capacity) cap_y, sum(prod_acc) acc_y, sum(prod_extras) ext_y from yr),
met as (select * from (values
    ('occ','% Occ','pct1',0),('bn','Bednights','int',1),('adb','ADB','eur',2),
    ('revpab','RevPab','eur',3),('acc','Prod Aloj.','keur',4),('ext','Prod Extras','keur',5),
    ('tot','Prod Total','keur',6)) t(metric,label,fmt,ord)),
months as (select * from (values
    (1,'Ene'),(2,'Feb'),(3,'Mar'),(4,'Abr'),(5,'May'),(6,'Jun'),
    (7,'Jul'),(8,'Ago'),(9,'Sep'),(10,'Oct'),(11,'Nov'),(12,'Dic')) t(mn,mlabel)),
body as (
  select me.label as row, mo.mlabel as col, mo.mn as "colOrd", me.ord as roword,
    (case me.metric
       when 'occ' then yr.bednights::numeric/nullif(yr.capacity,0)
       when 'bn' then yr.bednights::numeric
       when 'adb' then yr.prod_acc/nullif(yr.bednights,0)
       when 'revpab' then yr.prod_acc/nullif(yr.capacity,0)
       when 'acc' then yr.prod_acc
       when 'ext' then yr.prod_extras
       else yr.prod_acc+yr.prod_extras end) as v,
    me.fmt as fmt
  from met me cross join months mo join yr on yr.m=mo.mn),
tot as (
  select me.label as row, 'Total' as col, 99 as "colOrd", me.ord as roword,
    (case me.metric
       when 'occ' then yt.bn_y::numeric/nullif(yt.cap_y,0)
       when 'bn' then yt.bn_y::numeric
       when 'adb' then yt.acc_y/nullif(yt.bn_y,0)
       when 'revpab' then yt.acc_y/nullif(yt.cap_y,0)
       when 'acc' then yt.acc_y
       when 'ext' then yt.ext_y
       else yt.acc_y+yt.ext_y end) as v,
    me.fmt as fmt
  from met me cross join ytot yt)
select row, col, "colOrd", round(v::numeric,6) as v, fmt
from (select * from body union all select * from tot) z
where v is not null
order by roword, "colOrd"