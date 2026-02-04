const IORedis = require('ioredis');

const redis = new IORedis(process.env.REDIS_URL);

redis.ping()
    .then(() =>  {
        console.log('Redis connection succesful!');
        process.exit(0);
    })
    .catch((err) => {
        console.error('Redis connection failed');
        process.exit(1);
    })