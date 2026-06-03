import redis from '../config/redis.js'
const RETENTION_MS= Number(process.env.DB_RETENTION_MS || 300000);
function opportunityId(opportunity){
  return `${opportunity.pair}:${opportunity.buyOn}:${opportunity.sellOn}:${opportunity.timestamp}`

}
function normalizeOpportunity(opportunity) {
  return {
    id: opportunity.id,
    pair: opportunity.pair,
    buy_exchange:
      opportunity.buyOn ?? opportunity.buy_exchange,
    sell_exchange:
      opportunity.sellOn ?? opportunity.sell_exchange,
    buy_price:
      Number(opportunity.buyPrice ?? opportunity.buy_price),
    sell_price:
      Number(opportunity.sellPrice ?? opportunity.sell_price),
    net_spread:
      Number(opportunity.netSpread ?? opportunity.net_spread),
    est_profit:
      Number(opportunity.estProfit ?? opportunity.est_profit),
    detected_at:
      Number(opportunity.timestamp ?? opportunity.detected_at),
  };
}
async function hydrateOpportunityIds(ids){
  if(ids.length ===0) return []
  const values = await redis.mGet(
    ids.map(id=>`opportunity:${id}`)
  )
  return values.filter(Boolean)  //boolean filters out the null values
  .map(value=>JSON.parse(value));
}
export async function insertOpportunity(opportunity){
  const stored = normalizeOpportunity(opportunity);
   stored.id = opportunity.id ?? opportunityId(opportunity)

  const key = `opportunity:${stored.id}`
  await redis.set( //actual data storage happening here
  key, JSON.stringify(stored),
  {
    PX:RETENTION_MS     //attaches a ttl to key
  }
)
await redis.zAdd(   //zAdd allows to insert into a sorted list
  //sorted lists are basically perfect strings in redis tht has a score attached to them. this score helps in arraning the elements in cronological order for redis
  //the score we r gonna use is detected_at that is the timestamp 
  //this just stores score along with id not the entire object
  'opportunities:recent',
  {
    score:stored.detected_at,
    value : stored.id
  }
)
await redis.zAdd(
  `opportunities:pair:${stored.pair}`,
  {
    score:stored.detected_at,
    value:stored.id
  }
)
return stored

}
export async function getFreshOpportunities(freshSince,limit=50){
  const ids= await redis.zRangeByScore('opportunities:recent',
    freshSince,
    '+inf',
  {
    REV:true,
    LIMIT: {
      offset:0,
      count:limit
    }
  }
)
 return hydrateOpportunityIds(ids);

}
export async function getFreshOpportunitiesByPair(pair,
  freshSince,
  limit=50,
  
)
{
  const ids = await redis.zRangeByScore(
    `opportunities:pair:${pair}`,
    freshSince,
    '+inf',
    {
      REV:true,
      LIMIT:{
        offset:0,
        count:limit
      }
    }
  )
  return hydrateOpportunityIds(ids)
}

export async function getHistoryByPair(
  pair,
  limit=100

){
  const ids= await redis.zRange( //Range filters based on row in redis
    `opportunities:pair:${pair}`,
    -limit,
    -1,
    {
      REV:true
    }
  )
  return hydrateOpportunityIds(opportunityId)

}
//now redis deletes entires older than ttl
//but ids inside the Z sorted list has to be removed so we r doing it thru below function
export async function deleteExpiredOpportunities(cutoff){ //cutoff is the number of entires tht has to be delted{
const deleted = await redis.zRemRangeByScore(
  'opportunities:recent',
  '-inf',
  cutoff,
 
)
return{changes:deleted} //eg op changes:15 if 15 rows r deleted
}
export async function closeStorage(){
  await redis.quit()
}
export default redis;