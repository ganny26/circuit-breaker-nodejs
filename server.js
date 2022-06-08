const express = require('express')
const httpRequest = require('request')

const MollitiaPrometheus = require('@mollitia/prometheus')
const Mollitia = require('mollitia')

const app = express()
const { Circuit, Fallback, SlidingCountBreaker, BreakerState } = Mollitia

app.use(express.json({ urlencoded: true }))
Mollitia.use(new MollitiaPrometheus.PrometheusAddon())

const config1 = {
  name: 'sisCounter',
  slidingWindowSize: 6, // Failure Rate Calculation is done on the last 6 iterations
  minimumNumberOfCalls: 3, // 3 iterations are needed to start calculating the failure rate, and see if circuit should be opened or not
  failureRateThreshold: 60, // If half of the iterations or more are failing, the circuit is switched to Opened state.
  slowCallDurationThreshold: 500, // An iteration is considered as being slow if the iteration lasts more than 1s
  slowCallRateThreshold: 50, // If at least 80% of the iterations are considered as being slow, the circuit is switched to Opened state.
  permittedNumberOfCallsInHalfOpenState: 2, // When the circuit is in Half Opened state, the circuit accepts 2 iterations in this state.
  openStateDelay: 10000, // The circuit stays in Opened state for 10s
  halfOpenStateMaxDelay: 30000,
}

const config2 = {
  name: 'appCounter',
  slidingWindowSize: 6, // Failure Rate Calculation is done on the last 6 iterations
  minimumNumberOfCalls: 3, // 3 iterations are needed to start calculating the failure rate, and see if circuit should be opened or not
  failureRateThreshold: 50, // If half of the iterations or more are failing, the circuit is switched to Opened state.
  slowCallDurationThreshold: 500, // An iteration is considered as being slow if the iteration lasts more than 1s
  slowCallRateThreshold: 80, // If at least 80% of the iterations are considered as being slow, the circuit is switched to Opened state.
  permittedNumberOfCallsInHalfOpenState: 2, // When the circuit is in Half Opened state, the circuit accepts 2 iterations in this state.
  // Once these 2 iterations are received, failure rate is calculated on these iterations.
  // If failure rate is lower than failureRateThreshold, the circuit is switched to Closed state.
  // If the failure rate is higher or equal to failureRateThreshold, the circuit is switched to Opened state.
  openStateDelay: 10000, // The circuit stays in Opened state for 10s
}

const slidingCountBreaker = new SlidingCountBreaker(config2)

const fallback = new Fallback({
  callback(err) {
    // Every time the method rejects, You can filter here
    if (err) {
      return err.message
    }
  },
})

// Creates a circuit
const orderCircuit = new Circuit({
  name: 'Order Operations',
  options: {
    prometheus: {
      name: 'orderCircuit',
    },
    modules: [slidingCountBreaker, fallback],
  },
})

const orderController = {
  getOrders: (category) => {
    return new Promise((resolve, reject) => {
      httpRequest(
        {
          uri: `http://localhost:9191/orders?category=${category}`,
          method: 'GET',
        },
        (error, response, body) => {
          if (error) {
            reject(error)
          } else if (response) {
            if (response.statusCode === 200) {
              resolve(JSON.parse(body))
            } else {
              resolve(response.body)
            }
          }
        }
      )
    })
  },
}

app.get('/stats', (req, res) => res.send(MollitiaPrometheus.metrics()))

app.get('/orders', (req, res) => {
  orderCircuit
    .fn(() => orderController.getOrders(req.query.category))
    .execute()
    .then((result) => {
      console.log('Circuit State -->', slidingCountBreaker.state)
      res.send(result)
    })
    .catch((error) => {
      console.log('Circuit State -->', slidingCountBreaker.state)
      if (slidingCountBreaker.state === BreakerState.CLOSED) {
        res.send({
          status: false,
          message: "Order service is down",
        })
      } else {
        // Fallback Order response
        res.send([
          { id: '1', name: 'mobile', category: 'electronics', color: 'white', price: 20000 },
          { id: '4', name: 'Laptop', category: 'electronics', color: 'gray', price: 50000 },
        ])
      }
    })
})

app.listen(3000, () => {
  console.log('server is running on port 3000')
})
