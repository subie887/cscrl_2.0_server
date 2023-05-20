import express from 'express';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import dotenv from 'dotenv';
import crypto from 'crypto';

dotenv.config()

const randomFileName = (bytes = 32) => crypto.randomBytes(bytes).toString('hex')

const bucketName = process.env.BUCKET_NAME
const bucketRegion = process.env.BUCKET_REGION
const accessKey = process.env.ACCESS_KEY
const secretAccessKey = process.env.SECRET_ACCESS_KEY
const cloudfrontUrl = process.env.CLOUDFRONT_URL

const s3 = new S3Client({
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretAccessKey,
    },
    region: bucketRegion
});

const app = express()
app.use(cors());

app.use(function (req, res, next) {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET,HEAD,OPTIONS,POST,PUT,DELETE");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    next();
});

const prisma = new PrismaClient()

const storage = multer.memoryStorage()
const upload = multer({ storage: storage })

var port = process.env.PORT || 3000;


app.get("/api/posts", async (req, res) => {
    const posts = await prisma.videos.findMany({orderBy: [{ title: 'desc'}]})

    for (const post of posts) {
        post.videoUrl = `${cloudfrontUrl}/${"foldeer-upload-test"}/${post.fileName}`;
    }

    res.send(posts)
})

app.post("/api/posts", upload.single('file'), async (req, res) => {
    /* 
    console.log("req.body", req.body)
    console.log("req.file", req.file)
    */

    const fileName = `${randomFileName()}.${req.file.originalname.split('.').pop()}`
    const params = {
        Bucket: bucketName,
        Key: `${req.body.eventName?.replaceAll(" ", "-").toLowerCase()}/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
    }

    const command = new PutObjectCommand(params)

    await s3.send(command)

    
    const post = prisma.videos.create({
        data: {
            fileName: fileName,
            eventName: req.body.eventName,
            title: req.body.title,
            desc: req.body.desc,
        }
    })
    .then((createdVideo) => {
    console.log('Video created:', createdVideo);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    

    res.send({})
})


app.delete("/api/posts/:id", async (req, res) => {
    const id = +req.params.id
    const post = prisma.videos.findUnique({where: {id}}) 
    if (!post) {
        res.status(404).send("Not found")
        return
    }

    const params = {
        Bucket: bucketName,
        Key: post.title
    }

    const command = new DeleteObjectCommand(params)
    await s3.send(command)

    await prisma.videos.delete({where: {id}})

    res.send(post)
})

app.listen(port, function () {
  console.log('Example app listening on port ' + port + '!');
});