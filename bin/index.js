#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const Conf = require('conf').default;
// const open = require('open');
const program = new Command();
const config = new Conf({ projectName: 'insighta' });
const BACKEND_URL = process.env.BACKEND_URL || 'https://user-profiler-api.vercel.app';

const apiClient = axios.create({ baseURL: BACKEND_URL });

apiClient.interceptors.response.use(
    (response) => response,
    async (error) => {
        const originalRequest = error.config;
        if (error.response?.status === 401 && !originalRequest._retry) {
            originalRequest._retry = true;
            try {
                const refreshToken = config.get('refresh_token');
                const { data } = await axios.post(`${BACKEND_URL}/auth/refresh`, { refresh_token: refreshToken });
                
                config.set('access_token', data.access_token);
                config.set('refresh_token', data.refresh_token);
                
                originalRequest.headers['Authorization'] = `Bearer ${data.access_token}`;
                return apiClient(originalRequest); // Retry with new token
            } catch (refreshError) {
                console.log('Session expired. Please login again.');
                config.delete('access_token');
                config.delete('refresh_token');
                process.exit(1);
            }
        }
        return Promise.reject(error);
    }
);


program
  .name('insighta')
  .description('CLI for Insighta Labs+ System')
  .version('1.0.0');

program
  .command('whoami')
  .description('Check current login status')
  .action(async () => {
    // 1. Get the token we saved during login
    const token = config.get('access_token');
    
    if (!token) {
      console.log('You are not logged in. Run "insighta login" first.');
      return;
    }

    try {
      // 2. Ask the backend "Who is this token for?"
      const response = await apiClient.get(`${BACKEND_URL}/api/me`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'X-API-Version': '1' 
        }
      });

      const user = response.data.data;
      console.log(`Logged in as: @${user.username} (${user.role})`);
      
    } catch (err) {
      // If the token is old or fake, the backend will reject it
      console.log('Session expired or invalid. Please run "insighta login" again.');
    }
  });


const http = require('http');
const openBrowser = async (url) => {
    const { default: open } = await import('open');
    await open(url);
};
const { generateRandomString, generateCodeChallenge } = require('../utils');

program
  .command('login')
  .description('Login via GitHub OAuth')
  .action(async () => {
    const codeVerifier = generateRandomString(32);
    const codeChallenge = generateCodeChallenge(codeVerifier);
    const state = generateRandomString(16);
    
    // 1. Store the verifier locally (needed for the trade)
    config.set('code_verifier', codeVerifier);
    config.set('oauth_state', state);

    const server = http.createServer(async (req, res) => { // Added 'async'
      const url = new URL(req.url, 'http://localhost:3000');
      
      // IMPORTANT: PKCE looks for 'code', not 'access_token' in the URL
      const access_token = url.searchParams.get('access_token');
const refresh_token = url.searchParams.get('refresh_token');
const error = url.searchParams.get('error');

if (error) {
    res.end('<h1>Login Failed</h1><p>Check terminal for details.</p>');
    console.error('Auth error:', error);
    server.close();
    process.exit(1);
}

if (access_token && refresh_token) {
    config.set('access_token', access_token);
    config.set('refresh_token', refresh_token);
    config.delete('code_verifier');
    config.delete('oauth_state');

    res.end('<h1>Login Successful!</h1><p>You can close this tab.</p>');
    console.log('Successfully logged in!');
    server.close();
    process.exit(0);
} else {
    // Browser might hit this with favicon.ico or other requests
    // Just respond and keep waiting
    res.end('<h1>Waiting for authentication...</h1>');
}
    }).listen(3000, "127.0.0.1", async () => {
        // 4. Redirect to Backend with the Challenge
        const state = generateRandomString(16);
config.set('oauth_state', state); // save to verify later

const authUrl = `${BACKEND_URL}/auth/github?code_challenge=${codeChallenge}&state=${state}`;
        console.log('Opening browser for authentication...');
        const { default: openBrowser } = await import('open');
        await openBrowser(authUrl); 
    });
  });

program
  .description('List all available labs')
  .action(async () => {
    const token = config.get('access_token');
    
    if (!token) {
      console.log('Please login first: insighta login');
      return;
    }

    try {
        const response = await apiClient.get(`${BACKEND_URL}/api/labs`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const labs = response.data.data;

        if (labs.length === 0) {
            console.log('No labs found.');
            return;
        }

        console.log('\n--- Available Labs ---');
        labs.forEach(lab => {
            console.log(`[${lab.id}] ${lab.name} - ${lab.status || 'Active'}`);
        });
        console.log('----------------------\n');

    } catch (err) {
        console.error('Error fetching labs:', err.response?.data?.message || err.message);
    }
  });

  program
  .command('create <name>')
  .description('Create a new lab entry')
  .option('-d, --description <desc>', 'Add a description')
  .action(async (name, options) => {
    const token = config.get('access_token');
    if (!token) return console.log('❌ Login first!');

    try {
        console.log('Sending Headers:', { 'Authorization': `Bearer ${token}`, 'x-api-version': '1' });
      const response = await apiClient.post(`${BACKEND_URL}/api/labs`, {
        name,
        description: options.description || 'No description'
      }, {
        headers: { 
        'Authorization': `Bearer ${token}`,
        'X-API-Version': '1'
    },
        
      });

      console.log(`Created: ${response.data.data.name} (ID: ${response.data.data.id})`);
    } catch (err) {
      console.error('Error:', err.response?.data?.message || err.message);
    }
  });

  program
  .command('list')
  .description('List all lab entries')
  .action(async () => {
    const token = config.get('access_token');
    if (!token) return console.log('Login first!');

    try {
      const response = await apiClient.get(`${BACKEND_URL}/api/labs`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'x-api-version': '1' 
        }
      });

      console.log('\n--- Your Labs ---');
      if (response.data.data.length === 0) console.log('No labs found.');
      
      response.data.data.forEach(lab => {
        console.log(`[ID: ${lab.id}] ${lab.name} - Status: ${lab.status}`);
      });
      console.log('-------------------\n');

    } catch (err) {
      console.error('Error:', err.response?.data?.message || err.message);
    }
  });

  program
  .command('delete <id>')
  .description('Delete a lab entry by ID')
  .action(async (id) => {
    const token = config.get('access_token');
    
    try {
      await apiClient.delete(`${BACKEND_URL}/api/labs/${id}`, {
        headers: { 
          'Authorization': `Bearer ${token}`,
          'x-api-version': '1' 
        }
      });
      console.log(`Lab ${id} deleted.`);
    } catch (err) {
      console.error('Error:', err.response?.data?.message || err.message);
    }
  });

  const profiles = program.command('profiles').description('Manage profiles');

profiles
    .command('list')
    .description('List all profiles')
    .option('--gender <gender>', 'Filter by gender')
    .option('--country <country>', 'Filter by country code')
    .option('--age-group <ageGroup>', 'Filter by age group')
    .option('--min-age <minAge>', 'Filter by minimum age')
    .option('--max-age <maxAge>', 'Filter by maximum age')
    .option('--sort-by <sortBy>', 'Sort by field')
    .option('--order <order>', 'Sort order: asc or desc')
    .option('--page <page>', 'Page number', '1')
    .option('--limit <limit>', 'Results per page', '10')
    .action(async (options) => {
        const token = config.get('access_token');
        if (!token) return console.log('Not logged in. Run "insighta login" first.');

        try {
            const params = new URLSearchParams();
            if (options.gender)   params.append('gender', options.gender);
            if (options.country)  params.append('country_id', options.country);
            if (options.ageGroup) params.append('age_group', options.ageGroup);
            if (options.minAge)   params.append('min_age', options.minAge);
            if (options.maxAge)   params.append('max_age', options.maxAge);
            if (options.sortBy)   params.append('sort_by', options.sortBy);
            if (options.order)    params.append('order', options.order);
            params.append('page', options.page);
            params.append('limit', options.limit);

            console.log('Fetching profiles...');
            const res = await apiClient.get(`/api/profiles?${params.toString()}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-API-Version': '1'
                }
            });

            const { data, total, page, total_pages } = res.data;

            if (!data.length) {
                console.log('No profiles found.');
                return;
            }

            console.log(`\nPage ${page} of ${total_pages} (${total} total)\n`);
            console.table(data.map(p => ({
                Name: p.name,
                Gender: p.gender,
                Age: p.age,
                'Age Group': p.age_group,
                Country: p.country_name,
            })));
        } catch (err) {
            console.error('Error:', err.response?.data?.message || err.message);
        }
    });

profiles
    .command('get <id>')
    .description('Get a single profile by ID')
    .action(async (id) => {
        const token = config.get('access_token');
        if (!token) return console.log('Not logged in. Run "insighta login" first.');

        try {
            console.log('Fetching profile...');
            const res = await apiClient.get(`/api/profiles/${id}`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'X-API-Version': '1'
                }
            });
            console.log('\nProfile Details:');
            console.table([res.data.data]);
        } catch (err) {
            console.error('Error:', err.response?.data?.message || err.message);
        }
    });

profiles
    .command('search <query>')
    .description('Search profiles using natural language')
    .action(async (query) => {
        const token = config.get('access_token');
        if (!token) return console.log('Not logged in. Run "insighta login" first.');

        try {
            console.log('Searching...');
            const res = await apiClient.get(
                `/api/profiles/search?q=${encodeURIComponent(query)}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-API-Version': '1'
                    }
                }
            );
            const { data, total } = res.data;
            if (!data.length) {
                console.log('No results found.');
                return;
            }
            console.log(`\nFound ${total} result(s):\n`);
            console.table(data.map(p => ({
                Name: p.name,
                Gender: p.gender,
                Age: p.age,
                Country: p.country_name,
            })));
        } catch (err) {
            console.error('Error:', err.response?.data?.message || err.message);
        }
    });

profiles
    .command('create')
    .description('Create a new profile (admin only)')
    .requiredOption('--name <name>', 'Name to profile')
    .action(async (options) => {
        const token = config.get('access_token');
        if (!token) return console.log('Not logged in. Run "insighta login" first.');

        try {
            console.log(`Creating profile for "${options.name}"...`);
            const res = await apiClient.post('/api/profiles',
                { name: options.name },
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-API-Version': '1'
                    }
                }
            );
            console.log('\nProfile created:');
            console.table([res.data.data]);
        } catch (err) {
            console.error('Error:', err.response?.data?.message || err.message);
        }
    });

profiles
    .command('export')
    .description('Export profiles as CSV (admin only)')
    .option('--format <format>', 'Export format', 'csv')
    .option('--gender <gender>', 'Filter by gender')
    .option('--country <country>', 'Filter by country code')
    .option('--age-group <ageGroup>', 'Filter by age group')
    .action(async (options) => {
        const token = config.get('access_token');
        if (!token) return console.log('Not logged in. Run "insighta login" first.');

        try {
            const params = new URLSearchParams();
            params.append('format', options.format);
            if (options.gender)   params.append('gender', options.gender);
            if (options.country)  params.append('country_id', options.country);
            if (options.ageGroup) params.append('age_group', options.ageGroup);

            console.log('Exporting profiles...');
            const res = await apiClient.get(
                `/api/profiles/export?${params.toString()}`,
                {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'X-API-Version': '1'
                    },
                    responseType: 'text'
                }
            );

            const fs = require('fs');
            const path = require('path');
            const filename = `profiles_${Date.now()}.csv`;
            const filepath = path.join(process.cwd(), filename);
            fs.writeFileSync(filepath, res.data);
            console.log(`Exported to ${filepath}`);
        } catch (err) {
            console.error('Error:', err.response?.data?.message || err.message);
        }
    });

program.parse();