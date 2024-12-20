/*
    * Demucs3, a deep learning model for music source separation
    * NodeJS express server to separate audio files, and return the separated audio files
    * Author: @tonumber
    * Date: 2022-10-19
    * License: MIT
    * Version: 0.0.1
*/




// Import dependencies
const { getAudioDurationInSeconds } = require('get-audio-duration')
const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const https = require('https') // (for the ffmpeg/7z binary download)


// first time setup; create ./in and ./out, download the 7z and ffmpeg binaries
if (!fs.existsSync('./in')) {
    fs.mkdirSync('./in');
}
if (!fs.existsSync('./out')) {
    fs.mkdirSync('./out');
}
if (!fs.existsSync('./7za.exe')) {
    console.log('Downloading 7za.exe...');
    https.get('https://cdn.discordapp.com/attachments/1032448687667937372/1032448803103588433/7za.exe', (res) => {
        res.pipe(fs.createWriteStream('./7za.exe'));
    });
}
if (!fs.existsSync('./ffmpeg.exe')) {
    console.log('Downloading ffmpeg.exe...');
    https.get('https://cdn.discordapp.com/attachments/1032448687667937372/1032448802713501706/ffmpeg.exe', (res) => {
        res.pipe(fs.createWriteStream('./ffmpeg.exe'));
    });
}
// IF YOU DONT TRUST THIS!
// https://7-zip.org/a/7z2201-extra.7z for the 7za.exe
// https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-5.1.2-essentials_build.zip for the ffmpeg.exe
// you want to put 7za.exe in the same directory as this file, and ffmpeg.exe in the same directory as this file



// Set up express server
const app = express();
const useAuth = false;
app.set('port', process.env.PORT || 3000);
app.set('auth', useAuth);
app.set('authPassword', 'password');

// Set up multer to handle mp3 files

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'in/')
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname)
    }
});

const upload = multer({ storage: storage });
app.get('/queue', (req, res) => {
    res.json({ length: queue.length, limit: queueLimit });
});
// Set up routes
app.get('/', (req, res) => {
    res.send(`
    <html>
      <head>
        <title>Demucs3 API (${req.url})</title>
        <!-- bootstrap 5.1.3 -->
        <link rel="stylesheet" href="https://bootswatch.com/5/darkly/bootstrap.min.css">
        <script>
            function disableButton() {
                document.getElementById('submit').disabled = true;
                setTimeout(() => {
                    document.getElementById('submit').disabled = false;
                }, 5000);
            }
        </script>
      </head>
      <body>
        <div class="container">
          <h1>Demucs3</h1>
          <p>Separate audio files into vocals, drums, bass, and other.</p>
          <div class='card'>
            <div class='card-body'>
              <form action="/separate" method="post" enctype="multipart/form-data">
                <div class="mb-3">
                  <label for="file" class="form-label">Select audio file</label>
                  <input class="form-control" type="file" id="file" name="file">
                </div>
                <button type="submit" id='submit' class="btn btn-primary">Separate</button>
            </div>
            </form>
            <div class='card-footer'>
                <p id='length'>Queue length: ${queue.length}</p>
                <p id='limit'>Queue limit: ${queueLimit}</p>
            </div>
          </div>
          <p>Powered by <a href="https://nodejs.org">NodeJS</a> and <a href="https://github.com/facebookresearch/demucs">Demucs</a></p>
        </div>
        <script>
            // listen for submit button click
            setInterval(() => {
                fetch('/queue')
                    .then(res => res.json())
                    .then(data => {
                        document.getElementById('length').innerHTML = 'Queue length: ' + data.length;
                        document.getElementById('limit').innerHTML = 'Queue limit: ' + data.limit;
                    });
            }, 1000);
        </script>
      </body>
    </html>`)
});

// Set up queue system
const queue = [];
const queueLimit = 10;

function addToQueue(req, res) {
    if (queue.length < queueLimit) {
        queue.push({ req, res });
        return true;
    } else {
        return false;
    }
}

function removeFromQueue() {
    queue.shift();
}

function processQueue() {
    if (queue.length > 0) {
        const { req, res } = queue[0];
        separate(req, res);
    }
}

let stopPost = false;
// Set up separate route
app.post('/separate', upload.single('file'), (req, res) => {
    // debounce (so that the user can't spam the server)
    if (stopPost) {
        return
    }
    stopPost = true;
    setTimeout(() => {
        stopPost = false;
    }, 1000);
    if (addToQueue(req, res)) {
        processQueue();
    } else {
        res.status(429).send('Too many requests');
    }
});

function genId() {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}
// Set up separate function
async function separate(req, res) {
    const { file } = req;
    const { auth, authPassword } = req.app.settings;
    if (auth) {
        const { password } = req.query;
        if (password !== authPassword) {
            res.status(401).send('Unauthorized');
            removeFromQueue();
            processQueue();
            return;
        }
    }
    const { originalname, filename } = file;
    const fileExt = path.extname(originalname);
    const fileName = path.basename(originalname, fileExt);
    const fileDir = path.dirname(originalname);
    const outDir = `./out/${fileName}_${genId()}_demucs3`;
    const outFile = `${outDir}/out.zip`;
    const cmd = `python -m demucs.separate -n mdx_extra -o ${outDir} ./in/${filename}`;

    // get a time estimate for the separation (around 1.76 seconds of audio processed per second)

    const audioLength = await getAudioDurationInSeconds(`./in/${filename}`);
    console.log(`Processing ${originalname} (${audioLength} seconds)`);
    const timeEstimate = Math.round((audioLength * 1.76));

    console.log(`Separating ${originalname}...`);
    console.log(`Estimated time: ${timeEstimate} seconds`);
    console.log(`Output directory: ${outDir}`);
    console.log(`Output file: ${outFile}`);
    console.log(`Command: ${cmd}`);
    console.log('----------------------------------------');
    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.log(`error: ${error.message}`);
            res.status(500).send('Internal server error (line 122)');
            return;
        }
        if (stderr && false == true) {
            console.log(`stderr: ${stderr}`);
            res.status(500).send('Internal server error (stderr, see console) (line 127)');
            return;
        }
        console.log(`stdout: ${stdout}`);
        // zip the output files and send them to the client
        const zipCmd = `7z a -tzip ${outFile} ${outDir}/*`;
        exec(zipCmd, (error, stdout, stderr) => {
            if (error) {
                console.log(`error: ${error.message}`);
                res.status(500).send('Internal server error (zip)');
                return;
            }
            if (stderr) {
                console.log(`stderr: ${stderr}`);
                res.status(500).send('Internal server error (zip) (stderr)');
                return;
            }
            console.log(`stdout: ${stdout}`);

            // send the zip file to the client
            res.download(outFile, (err) => {
                if (err) {
                    console.log('ERROR ON ZIP!', err);
                    res.status(500).send('Internal server error on zip');
                    // delete the input and output files
                    fs.unlinkSync(`./in/${filename}`);
                    fs.rmdirSync(outDir, { recursive: true });

                    // remove the file from the queue
                    removeFromQueue();
                } else {
                    // delete the input and output files
                    fs.unlinkSync(`./in/${filename}`);
                    fs.rmdirSync(outDir, { recursive: true });

                    // remove the file from the queue
                    removeFromQueue();
                }
            });
        });
    });
}

// Start server
app.listen(app.get('port'), () => {
    console.log(`Server started on port ${app.get('port')}`);
});
