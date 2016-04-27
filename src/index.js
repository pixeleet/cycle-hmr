import {Observable, ReplaySubject} from 'rx'

const proxiesStore = {}

const isObservable = (obj) => {
  return obj && typeof obj.subscribe === 'function'
}

const _makeSinkProxies = (sinks, makeProxy) => {
  let proxies = {}
  let validSinks = false
  let keys = Object.keys(sinks)
  keys.forEach((key) => {
    let sink = sinks[key]
    if (isObservable(sink)){
      validSinks = true
      proxies[key] = makeProxy(sink)
    } else {
      proxies[key] = sink
    }
  })
  return validSinks && proxies
}

const makeSinkProxyObservable = (sink) => {
  let proxy = {}
  proxy.stream = Observable.create((observer) => {
    proxy.observer = observer
    proxy.subscription = sink.subscribe(observer)
  })
  return proxy
}

const makeSinkProxySubject = (sink, replayCount = 0) => {
  let subject = new ReplaySubject(replayCount)
  return {
    stream: subject,
    observer: subject,
    subscription: sink.subscribe(subject)
  }
}

const makeSinkProxiesSubjects = (sinks, replayCount) =>
  _makeSinkProxies(sinks, (sink) => makeSinkProxySubject(sink, replayCount))

const makeSinkProxiesObservables = (sinks) =>
  _makeSinkProxies(sinks, makeSinkProxyObservable)

const getProxyStreams = (proxies, debug) => {
  return Object.keys(proxies).reduce((obj, key) => {
    let proxy = proxies[key]
    if (isObservable(proxy && proxy.stream)){
      obj[key] = proxy.stream.finally(() => {
        //if (proxies[key].subscribtion){
        proxy.subscription.dispose()
        //}
      })
    } else {
      debug(`no proxy stream for sink \`${key}\``)
    }
    return obj
  }, {})
}

const SubscribeProxies = (proxies, sinks, debug) => {
  if (isObservable(sinks)){
    sinks = {sinks}
  }
  return Object.keys(sinks).forEach((key) => {
    const proxy = proxies[key]
    proxy.subscription = sinks[key].subscribe(proxy.observer)
  }, {})
}

const UnsubscribeProxies = (proxies, debug) => {
  return Object.keys(proxies).forEach((key) => {
    if (proxies[key].subscription){
      proxies[key].subscription.dispose()
    } else {
      debug(`no subscription for sink \`${key}\``)
    }
  }, {})
}

const getDebugMethod = (value) =>
  typeof console === 'object'
    ? typeof console[value] === 'function' ? value
      : console['log'] ? 'log' : ''
    : ''

export const hmrProxy = (dataflow, proxyId, options = {}) => {
  
  if (typeof dataflow !== 'function'){
    return dataflow
  }

  if (typeof proxyId !== 'string'){
    throw new Error('You should provide string value of proxy id')
  }

  let debug = () => {}
  if (options.debug){
    const debugMethod = getDebugMethod(options.debug)
    debug = debugMethod
      ? (message) => console[debugMethod](`[Cycle HRM] proxy ${proxyId}: ${message}`)
      : debug
  }

  const makeSinkProxies = options.useSubject ?
    (sinks) => makeSinkProxiesSubjects(parseInt(options.useSubject) || 0)
  : makeSinkProxiesObservables
  
  debug('created')
  let proxiedInstances = proxiesStore[proxyId]
  
  if (proxiedInstances){
    proxiedInstances.forEach(({proxies, sources, rest}) => {
      debug('reload')
      UnsubscribeProxies(proxies, debug)
      let sinks = dataflow(sources, ...rest)
      SubscribeProxies(proxies, sinks, debug)
    })
  } else {
    proxiedInstances = proxiesStore[proxyId] = []
  }
  
  return (sources, ...rest) => {
    debug('execute')
    const sinks = dataflow(sources, ...rest)
    if (isObservable(sinks)){
      let proxies = makeSinkProxies({sinks})
      proxiedInstances.push({sources, proxies, rest})
      return getProxyStreams(proxies, debug).sinks
    } else if (typeof sinks  === 'object') {
      let proxies = makeSinkProxies(sinks)
      if (!proxies){
        debug('sink not a stream result')
        return sinks
      }
      proxiedInstances.push({sources, proxies, rest})
      return getProxyStreams(proxies, debug)
    } else {
      debug('sink not a stream result')
      return sinks
    }
  }
}

export {hmrProxy as proxy}
