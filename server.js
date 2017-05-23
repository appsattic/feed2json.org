// --------------------------------------------------------------------------------------------------------------------

// core
const http = require('http')
const path = require('path')
const crypto = require('crypto')
const fs = require('fs')

// npm
const express = require('express')
const morgan = require('morgan')
const request = require('request')
const validUrl = require('valid-url')
const FeedParser = require('feedparser')
const helmet = require('helmet')

// local
const booleanify = require('./lib/booleanify.js')
const convert = require('./lib/convert.js')

// --------------------------------------------------------------------------------------------------------------------
// setup

// let redisClient = redis.createClient()

const cacheDir = '/var/lib/feed2json/cache'

// --------------------------------------------------------------------------------------------------------------------
// helpers

const files = path.join(__dirname, 'static')

function sendError(res, status, err) {
  res.status(status).json({
    "err" : '' + err,
  })
}

// From : https://github.com/danmactough/node-feedparser/blob/master/examples/iconv.js (with changes)
function getHeaderParams(header) {
  return ( header || '' ).split(';').reduce((acc, val) => {
    var kv = val.split('=')
    acc[kv[0].trim()] = ( kv[1] || '' ).trim()
    return acc
  }, {})
}

function sendJson(res, minify, data) {
  if ( minify ) {
    res.json(data)
  }
  else {
    res.set({'Content-Type': 'application/json; charset=utf-8'})
    res.status(200)
    res.send(JSON.stringify(data, undefined, '  '))
  }
}

// --------------------------------------------------------------------------------------------------------------------
// application

var app = express()

app.use(helmet())
app.use(morgan(process.env.NODE_ENV === 'production' ? 'tiny' : 'dev'))
app.use(express.static('static'))

app.get('/convert', (req, res) => {
  let queryUrl = req.query.url
  let minify = booleanify(req.query.minify)

  console.log('queryUrl=' + queryUrl)
  console.log('minify=' + minify)

  let responseSent = false

  if ( !queryUrl ) {
    responseSent = true
    return sendError(res, 400, "provide a 'url' parameter in your query")
  }

  // check if this looks like a valid URL
  let url = validUrl.isWebUri(queryUrl)
  if ( !url ) {
    responseSent = true
    return sendError(res, 400, "invalid 'url' : " + queryUrl)
  }

  console.log('validUrl=' + url)

  // get the hash of this URL
  let hashAcc = crypto.createHash('sha256')
  hashAcc.update(url)
  let hash = hashAcc.digest('hex').substr(0, 12)
  console.log('hash=' + hash)

  // check to see if we can open the cached file and send it - nice and easy
  let feedFilename = path.join(cacheDir, hash)
  let jsonFilename = path.join(cacheDir, hash + '.json')
  let jsonMinFilename = path.join(cacheDir, hash + '.min.json')
  let filename = minify ? jsonMinFilename : jsonFilename
  console.log('feed=' + feedFilename)
  console.log('json=' + jsonFilename)
  console.log('min =' + jsonMinFilename)
  res.sendFile(filename, (err) => {
    // if there was no error, then the JSON file exists and was sent
    if ( !err ) {
      console.log('Sent JSON file as response : ' + filename)
      return
    }

    // file probably doesn't exist, but it could be a different error
    if ( err.code !== 'ENOENT' ) {
      console.error('Error calling res.sendFile:', err)
      return sendError(res, 500, "Error opening cached file:" + err)
    }

    // file doesn't exist yet (ENOENT) - that can be expected, so just carry on normally

    // let's hit the URL to fetch the feed
    let fetch = request(url, { timeout : 10000, pool : false }, (err, response, body) => {
      if (err) {
        console.error('Error calling request:', err)
        return sendError(err, 500, "Error calling request:" + err)
      }

      // write this file out
      fs.writeFile(feedFilename, body, (err) => {
        if (err) {
          console.error('Error calling fs.writeFile:', err)
          return sendError(err, 500, "Error calling fs.writeFile:" + err)
        }

        // now process the body and get the data back
        convert(feedFilename, url, body, (data) => {
          // now, write the response to disk, but we can also write the body out to the user already
          sendJson(res, minify, data)

          // whilst the response is being sent, we can write this data to the two cached files
          fs.writeFile(jsonFilename, JSON.stringify(data, undefined, '  '), (err) => {
            if (err) {
              return console.errro('Error writing JSON file ' + jsonFilename + ' : ' + err)
            }
            console.log('Written JSON file : ' + jsonFilename)
          })

          // and the minified version
          fs.writeFile(jsonMinFilename, JSON.stringify(data), (err) => {
            if (err) {
              return console.errro('Error writing JSON file ' + jsonMinFilename + ' : ' + err)
            }
            console.log('Written JSON file : ' + jsonMinFilename)
          })
        })
      })
    })

    // set some headers on the request
    fetch.setHeader('user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/42.0.2311.135 Safari/537.36 Edge/12.246')
    fetch.setHeader('accept', 'text/html,application/xhtml+xml')
  })
})

// --------------------------------------------------------------------------------------------------------------------
// server

const port = process.env.PORT || 3000
const server = http.createServer(app)
server.listen(port, () => {
  console.log('Listening on port %s', port)
})

// --------------------------------------------------------------------------------------------------------------------
