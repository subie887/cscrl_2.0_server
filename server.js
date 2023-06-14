import express from 'express';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import { S3Client, PutObjectCommand, DeleteObjectCommand, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import { AdminGetUserCommand, AdminInitiateAuthCommand, CognitoIdentityProviderClient, InitiateAuthCommand, RespondToAuthChallengeCommand, SignUpCommand } from '@aws-sdk/client-cognito-identity-provider';
import dotenv from 'dotenv';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';

dotenv.config()

const randomFileName = (bytes = 32) => crypto.randomBytes(bytes).toString('hex')

const bucketName = process.env.BUCKET_NAME
const region = process.env.BUCKET_REGION
const accessKey = process.env.ACCESS_KEY
const secretAccessKey = process.env.SECRET_ACCESS_KEY
const cloudfrontUrl = process.env.CLOUDFRONT_URL

const cognitoClientId = process.env.COGNITO_CLIENT_ID
const cognitoUserPoolId = process.env.COGNITO_USERPOOL_ID

const s3 = new S3Client({
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretAccessKey,
    },
    region: region
});

const cognito = new CognitoIdentityProviderClient({
    credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretAccessKey,
    },
    region: region 
})

const app = express()
app.use(
    cors({
        origin: ["http://localhost:5173", "https://cscrl.onrender.com"],
        
    })
);

app.options('*', cors());


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



app.get("/api/videos/:confname", async (req, res) => {
    const videos = await prisma.videos.findMany({
        where: {
            eventName: req.params.confname
        },
        orderBy: {
            createdAt: 'asc'
        }
    })

    for (const video of videos) {
        video.url = `${cloudfrontUrl}/${video.eventName}/${video.fileName}`
    }
    
    res.send(videos)
})

app.get("/api/events", async (req, res) => {
    const videos = await prisma.videos.findMany({ 
        distinct: ['eventName'],
        select: {
            eventName: true,
            createdAt: true,
        },
        orderBy: {
            createdAt: 'desc'
        }
    })
    let uniqueEventNames = []

    for (const video of videos) {
        uniqueEventNames.push(video.eventName)
    }

    res.send(uniqueEventNames)
})

app.get("/api/associates", async (req, res) => {
    const associates = await prisma.associates.findMany({
        orderBy: [
            { firstName: "desc" },
            { lastName: 'desc' },
        ]
    })

    for(const associate of associates) {
        associate.img = `${cloudfrontUrl}/people-photos/${associate.img}`
    }

    res.send(associates)
})

app.get("/api/calendar", async (req, res) => {
    const events = await prisma.calendar.findMany({
        orderBy: [
            { date: "asc" },
        ]
    })

    const { pastEvents, futureEvents } = events.reduce(
        (accumulator, event) => {
          if (event.date < new Date()) {
            accumulator.pastEvents.push(event);
          } else {
            accumulator.futureEvents.push(event);
          }
          return accumulator;
        },
        { pastEvents: [], futureEvents: [] }
    );
    
    const sortedFutureEvents = futureEvents.sort((a, b) => b.date - a.date);
    const sortedPastEvents = pastEvents.sort((a, b) => a.date - b.date);
    
    const sortedEvents = sortedFutureEvents.concat(sortedPastEvents);

    res.send(sortedEvents)
})

app.get("/api/contacts", async (req, res) => {
    const contacts = await prisma.contacts.findMany()

    res.send(contacts)
})

app.get("/api/lrmi", async (req, res) => {
    const reports = await prisma.lrmi.groupBy({ by: ["year"] })
    let uniqueReportYears = []

    for (const report of reports) {
        uniqueReportYears.push(report.year)
    }

    res.send(uniqueReportYears.sort((a, b) => b - a))
})

app.get("/api/newsletter", async (req, res) => {
    const letters = await prisma.newsletter.groupBy({ by: ["year"] })
    let uniqueLetterYears = []

    for (const letter of letters) {
        uniqueLetterYears.push(letter.year)
    }

    res.send(uniqueLetterYears.sort((a, b) => b - a))
})

app.get("/api/lrmi/:year", async (req, res) => {
    const reports = await prisma.lrmi.findMany({
        where: {
            year: parseInt(req.params.year),
        },
        orderBy: {
            quarter: 'asc',
        }
    })

    for (const report of reports) {
        report.url = `${cloudfrontUrl}/lrmi-pdf/${report.fileName}`
    }

    res.send(reports)
})

app.get("/api/newsletter/:year", async (req, res) => {
    const letters = await prisma.newsletter.findMany({
        where: {
            year: parseInt(req.params.year),
        },
        orderBy: {
            month: 'desc',
        }
    })

    for (const letter of letters) {
        letter.url = `${cloudfrontUrl}/newsletter-pdf/${letter.fileName}`
    }

    res.send(letters)
})


app.post("/api/videos", upload.single('file'), async (req, res) => {

    const fileName = `${randomFileName()}.${req.file.originalname.split('.').pop()}`
    const params = {
        Bucket: bucketName,
        Key: `${req.body.eventName}/${fileName}`,
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
            createdAt: new Date(),
        }
    })
    .then((created) => {
    console.log('Video created:', created);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    

    res.send({})
})

app.post("/api/associates", upload.single('img'), async (req, res) => {

    console.log(`FILE: ${req.file}`)
    const fileName = `${randomFileName()}.${req.file.originalname.split('.').pop()}`
    const params = {
        Bucket: bucketName,
        Key: `people-photos/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
    }

    const command = new PutObjectCommand(params)

    await s3.send(command)

    
    const post = prisma.associates.create({
        data: {
            img: fileName,
            firstName: req.body.firstName,
            lastName: req.body.lastName,
            role: req.body.role,
            bio: req.body.bio,
        }
    })
    .then((createdPerson) => {
    console.log('Person created:', createdPerson);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    

    res.send({})
})

app.post("/api/associates/:id/docs", upload.single('pdf'), async (req, res) => {
    const id = req.params.id

    const fileName = `${randomFileName()}.${req.file.originalname.split('.').pop()}`
    const params = {
        Bucket: bucketName,
        Key: `research-pdf/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
    }

    const command = new PutObjectCommand(params)

    await s3.send(command)

    
    const post = prisma.associates.update({
        where: {id},
        data: {
            docs: {
                push: {
                    title: req.body.title,
                    fileName: fileName,
                    link: `${cloudfrontUrl}/research-pdf/${fileName}`,
                }
            },
        }
    })
    .then((createdDoc) => {
    console.log('Document created:', createdDoc);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    

    res.send({})
})

app.post("/api/calendar", upload.none(), async (req, res) => {
    const post = prisma.calendar.create({
        data: {
            title: req.body.title,
            desc: req.body.desc,
            date: new Date(req.body.date),
        }
    })
    .then((created) => {
    console.log('Document created:', created);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    
    console.log(post)
    res.send({})
})

app.post("/api/lrmi", upload.single('pdf'), async (req, res) => {
    const id = req.params.id

    const fileName = `${randomFileName()}.${req.file.originalname.split('.').pop()}`
    const params = {
        Bucket: bucketName,
        Key: `lrmi-pdf/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
    }

    const command = new PutObjectCommand(params)

    await s3.send(command)

    const post = prisma.lrmi.create({
        data: {
            fileName: fileName,
            year: parseInt(req.body.year),
            quarter: parseInt(req.body.quarter),
        }
    })
    .then((createdDoc) => {
    console.log('Document created:', createdDoc);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    

    res.send({})
})

app.post("/api/newsletter", upload.single('pdf'), async (req, res) => {
    const id = req.params.id

    const fileName = `${randomFileName()}.${req.file.originalname.split('.').pop()}`
    const params = {
        Bucket: bucketName,
        Key: `newsletter-pdf/${fileName}`,
        Body: req.file.buffer,
        ContentType: req.file.mimetype
    }

    const command = new PutObjectCommand(params)

    await s3.send(command)

    const post = prisma.newsletter.create({
        data: {
            fileName: fileName,
            year: parseInt(req.body.year),
            month: parseInt(req.body.month),
            title: `${req.body.title} (PDF)`,
        }
    })
    .then((createdDoc) => {
    console.log('Document created:', createdDoc);
    // Handle the response or send a success message
    })
    .catch((error) => {
    console.error('Error creating video:', error);
    // Handle the error or send an error response
    });
    

    res.send({})
})


app.post("/auth/signin", upload.single('none'), async (req, res) => {
    
    const getUserParams = {
        UserPoolId: cognitoUserPoolId,
        Username: req.body.email,
    }
    
    const getUserCommand = new AdminGetUserCommand(getUserParams)
    
    //Get user status
    const userInfo = await cognito.send(getUserCommand)
    const isFirstLogin = userInfo.UserStatus === 'FORCE_CHANGE_PASSWORD' || userInfo.UserStatus === 'RESET_REQUIRED'
    const authFlow = isFirstLogin ? 'ADMIN_USER_PASSWORD_AUTH' : 'USER_PASSWORD_AUTH'
    //Auth params
    
    const params = {
        AuthFlow: authFlow,
        ClientId: cognitoClientId,
        UserPoolId: cognitoUserPoolId,
        AuthParameters: {
            USERNAME: req.body.email,
            PASSWORD: req.body.password,
        },
    }
    
    try {
        if(isFirstLogin){
            const command = new AdminInitiateAuthCommand(params)
            const result = await cognito.send(command)
            res.send(result)
        } else {
            const command = new InitiateAuthCommand(params)
            const result = await cognito.send(command)
            result.AuthenticationResult.decoded = jwt.decode(result.AuthenticationResult.IdToken)
            res.send(result)
        }
    } catch (error) {
        res.send({}).status(400)
    }
    
})

app.post("/auth/register", upload.single('none'), async (req, res) => {
    const params = {
        ClientId: cognitoClientId,
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        Session: req.body.session,
        ChallengeResponses: {
            NEW_PASSWORD: req.body.newPassword,
            USERNAME: req.body.username,
            "userAttributes.given_name": req.body.firstName,
            "userAttributes.family_name": req.body.lastName
        }
    }

    const command = new RespondToAuthChallengeCommand(params)
    const result = await cognito.send(command)
    try {
        res.send(result)
    } catch (error) {
        res.send(error)
    }
})

app.delete("/api/videos/:id", async (req, res) => {
    const id = req.params.id
    console.log(`Deleting ${id}`)
    const post = await prisma.videos.findUnique({where: {id}}) 
    
    if (!post) {
        res.status(404).send("Not found")
        return
    }

    const params = {
        Bucket: bucketName,
        Key: `${post.eventName}/${post.fileName}`
    }

    console.log(`Deleting ${params.Key}`)

    const command = new DeleteObjectCommand(params)
    await s3.send(command)

    await prisma.videos.delete({
        where: {id}
    })

    res.send(post)
})

app.delete("/api/associates/:id", async (req, res) => {
    const id = req.params.id
    console.log(`Deleting ${id}`)
    
    const post = await prisma.associates.findUnique({where: {id}}) 
    if (!post) {
        res.status(404).send("Not found")
        return
    }

    let doclist = []

    if(!(post.docs === undefined || post.docs.length == 0)){

        console.log("Triggered")
        console.log(post.docs)
        
        for (const doc of post.docs) {
            doclist.push(
                {
                    Key: `research-pdf/${doc.fileName}`
                }
            )
        }

        const paramspdf = {
            Bucket: bucketName,
            Delete: {
                Objects: doclist,
            }
        }

        const commandpdf = new DeleteObjectsCommand(paramspdf)
        await s3.send(commandpdf)
    }
    
    const params = {
        Bucket: bucketName,
        Key: `people-photos/${post.img}`
    }
    

    console.log(`Deleting ${params.Key}`)
    
    
    const command = new DeleteObjectCommand(params)
    await s3.send(command)
    await prisma.associates.delete({where: {id}})
    
    res.send(post)
})

app.delete("/api/calendar/:id", async (req, res) => {
    const id = req.params.id
    console.log(`Deleting ${id}`)
    const post = await prisma.calendar.findUnique({where: {id}}) 
    
    if (!post) {
        res.status(404).send("Not found")
        return
    }

    await prisma.calendar.delete({
        where: {id}
    })

    res.send(post)
})

app.delete("/api/lrmi/:id", async (req, res) => {
    const id = req.params.id
    console.log(`Deleting ${id}`)
    const post = await prisma.lrmi.findUnique({where: {id}}) 
    
    if (!post) {
        res.status(404).send("Not found")
        return
    }

    const params = {
        Bucket: bucketName,
        Key: `lrmi-pdf/${post.fileName}`
    }

    console.log(`Deleting ${params.Key}`)

    const command = new DeleteObjectCommand(params)
    await s3.send(command)

    await prisma.lrmi.delete({
        where: {id}
    })

    res.send(post)
})

app.delete("/api/newsletter/:id", async (req, res) => {
    const id = req.params.id
    console.log(`Deleting ${id}`)
    const post = await prisma.newsletter.findUnique({where: {id}}) 
    
    if (!post) {
        res.status(404).send("Not found")
        return
    }

    const params = {
        Bucket: bucketName,
        Key: `newsletter-pdf/${post.fileName}`
    }

    console.log(`Deleting ${params.Key}`)

    const command = new DeleteObjectCommand(params)
    await s3.send(command)

    await prisma.newsletter.delete({
        where: {id}
    })

    res.send(post)
})

app.listen(port, function () {
  console.log(new Date() +' app listening on port ' + port + '!');
});