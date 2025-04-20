const { test, expect } = require('@playwright/test');

test.describe('Check some performance metrics', () => {
  test('check page load time page from marks', async ({ page }) => {
    // Create performance marker
    await page.addInitScript(() => {
      window.performance.mark('start-loading');
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    
    await page.goto('https://playwright.dev/docs/intro');
    
    // Add end marker and measure page load time
    const loadTimeMs = await page.evaluate(() => {
      window.performance.mark('end-loading');
      window.performance.measure('pageLoad', 'start-loading', 'end-loading');
      const measure = window.performance.getEntriesByName('pageLoad')[0];
      return measure.duration;
    });
    
    console.log(`Time noted by marks - ${loadTimeMs}`);
    expect(loadTimeMs).toBeLessThan(1000);
  });

  test('check page load time from PerformanceNavigationTimings', async ({ page }) => {
    await page.goto('https://playwright.dev/docs/intro');
    
    // Get performance navigation metrics
    const perfMetrics = await page.evaluate(() => {
      const navEntry = performance.getEntriesByType('navigation')[0];
      return {
        totalDuration: (navEntry as PerformanceNavigationTiming).duration,
        connectTime: (navEntry as PerformanceNavigationTiming).connectEnd - (navEntry as PerformanceNavigationTiming).connectStart,
        responseTime: (navEntry as PerformanceNavigationTiming).responseEnd - (navEntry as PerformanceNavigationTiming).startTime,
        loadEventTime: (navEntry as PerformanceNavigationTiming).loadEventEnd - (navEntry as PerformanceNavigationTiming).startTime,
        processingTime: (navEntry as PerformanceNavigationTiming).loadEventEnd - (navEntry as PerformanceNavigationTiming).responseEnd
      };
    });
    
    // Log the performance metrics
    console.log('Time noted by duration of PerformanceNavigationTimings - ' + perfMetrics.totalDuration);
    console.log('Time noted by PerformanceNavigationTimings - connectStart to connectEnd - ' + perfMetrics.connectTime);
    console.log('Time noted by PerformanceNavigationTimings - startTime to responseEnd - ' + perfMetrics.responseTime);
    console.log('Time noted by PerformanceNavigationTimings - startTime to loadEventEnd - ' + perfMetrics.loadEventTime);
    console.log('Time noted by PerformanceNavigationTimings - responseEnd to loadEventEnd - ' + perfMetrics.processingTime);
    
    expect(perfMetrics.totalDuration).toBeLessThan(3000, 'Total duration time should be reasonable');
    expect(perfMetrics.connectTime).toBeLessThan(500, 'Connection time should be reasonable');
    expect(perfMetrics.responseTime).toBeLessThan(2000, 'Response time should be reasonable');
    expect(perfMetrics.loadEventTime).toBeLessThan(2500, 'Load event time should be reasonable');
    expect(perfMetrics.processingTime).toBeLessThan(1000, 'Processing time should be reasonable');
  });
  
  test('ensure max load time for images', async ({ page }) => {
    await page.goto('https://playwright.dev/docs/intro');
    
    // Get performance entries for images
    const imgPerformance = await page.evaluate(() => {
      const imgs = performance.getEntriesByType('resource')
        .filter(entry => (entry as PerformanceResourceTiming).initiatorType === 'img');
      
      // Find the slowest image
      const slowestImg = imgs.reduce(
        (prev, current) => current.duration > prev.duration ? current : prev,
        { duration: 0, name: 'none' }
      );
      
      return {
        duration: slowestImg.duration,
        name: slowestImg.name
      };
    });
    
    // Log and assert the slowest image load time
    console.log(`Slowest image '${imgPerformance.name}' loaded in ${imgPerformance.duration}ms`);
    expect(imgPerformance.duration).toBeLessThan(400, 
      `Image '${imgPerformance.name}' should be loaded in reasonable time`);
  });
  
  test('check detailed resource timing', async ({ page }) => {
    // Navigate to the URL
    await page.goto('https://playwright.dev/docs/intro'); 
    
    // Analyze resource timing entries
    const resourceTimings = await page.evaluate(() => {
      // Get all resource timing entries
      const resources = performance.getEntriesByType('resource');
      
      // Calculate total resources and their sizes
      const totalResources = resources.length;
      const totalSize = resources.reduce((sum, resource) => sum + ((resource as PerformanceResourceTiming).transferSize || 0), 0);
      
      // Group resources by type
      const resourcesByType = resources.reduce((acc, resource) => {
        const type = (resource as PerformanceResourceTiming).initiatorType || 'other';
        if (!acc[type]) acc[type] = [];
        acc[type].push(resource);
        return acc;
      }, {});
      
      // Calculate statistics for each type
      const stats = {};
      for (const [type, typeResources] of Object.entries(resourcesByType)) {
        const resources = typeResources as PerformanceResourceTiming[];
        stats[type] = {
          count: resources.length,
          totalSize: resources.reduce((sum, r) => sum + (r.transferSize || 0), 0),
          totalDuration: resources.reduce((sum, r) => sum + r.duration, 0),
          avgDuration: resources.reduce((sum, r) => sum + r.duration, 0) / resources.length
        };
      }
      
      return { totalResources, totalSize, stats };
    });
    
    console.log(`Total resources: ${resourceTimings.totalResources}`);
    console.log(`Total size: ${Math.round(resourceTimings.totalSize / 1024)} KB`);
    
    for (const [type, stats] of Object.entries(resourceTimings.stats)) {
      console.log(`
        Type: ${type}
        Count: ${(stats as any).count}
        Total Size: ${Math.round((stats as any).totalSize / 1024)} KB
        Avg Duration: ${Math.round((stats as any).avgDuration)} ms
      `);
    }
    
    expect(resourceTimings.totalResources).toBeGreaterThan(0);
  });
  
  test('check first contentful paint and other web vitals', async ({ page }) => {
    // This requires enabling the appropriate Chrome flags
    page.on('console', msg => console.log(`[Browser Console] ${msg.text()}`));
    
    await page.goto('https://playwright.dev/docs/intro');
    
    const webVitals = await page.evaluate(() => {
      return new Promise(resolve => {
        // Check if the browser supports the Performance Observer API
        if (!('PerformanceObserver' in window)) {
          return resolve({ error: 'PerformanceObserver not supported' });
        }
        
        // Create an object to store the metrics
        const metrics = {};
        
        // Get FCP if available
        const fcpEntry = performance.getEntriesByName('first-contentful-paint')[0];
        if (fcpEntry) {
          (metrics as {[key: string]: number})['FCP'] = fcpEntry.startTime;
        }
        
        // Get LCP, CLS, FID through PerformanceObserver  
        const observer = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          entries.forEach(entry => {
            // PerformanceEntry doesn't have value property, use duration instead
            metrics[entry.name] = entry.duration || entry.startTime;
          });
          
          // After a timeout, resolve with the collected metrics
          setTimeout(() => resolve(metrics), 1000);
        });
        
        // Observe paint timing entries
        observer.observe({ type: 'paint', buffered: true });
        
        // If we haven't resolved yet, do it after a timeout
        setTimeout(() => resolve(metrics), 3000);
      });
    });
    
    console.log('Web Vitals:', webVitals);
    
    // Add assertions if metrics are available
    if (webVitals.FCP) {
      expect(webVitals.FCP).toBeLessThan(2000);
    }
  });
});