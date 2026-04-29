#!/usr/bin/env node

const { Command } = require('commander');
const axios = require('axios');
const Conf = require('conf').default;
const open = require('open');
const program = new Command();
const config = new Conf({ projectName: 'insighta' });
const BACKEND_URL = 'http://localhost:8000';

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
    
    // 1. Store the verifier locally (needed for the trade)
    config.set('code_verifier', codeVerifier);

    const server = http.createServer(async (req, res) => { // Added 'async'
      const url = new URL(req.url, 'http://localhost:3000');
      
      // IMPORTANT: PKCE looks for 'code', not 'access_token' in the URL
      const code = url.searchParams.get('code');

      if (code) {
          try {
              // 2. THE TRADE: Exchange the code + verifier for tokens
              const response = await apiClient.post(`${BACKEND_URL}/auth/github/callback`, {
                  code: code,
                  code_verifier: config.get('code_verifier')
              });

              const { access_token, refresh_token } = response.data;

              // 3. Save the actual JWTs from our backend
              config.set('access_token', access_token);
              config.set('refresh_token', refresh_token);
              config.delete('code_verifier'); // Cleanup

              res.end('<h1>Login Successful!</h1><p>You can close this tab.</p>');
              console.log('✅ Successfully logged in! Tokens saved.');
              process.exit(0);

          } catch (err) {
              console.error('❌ Exchange failed:', err.response?.data?.message || err.message);
              res.end('<h1>Login Failed</h1><p>Check terminal for details.</p>');
              process.exit(1);
          }
      } else {
          res.end('<h1>Login Failed</h1><p>No authorization code received.</p>');
      }
    }).listen(3000, "127.0.0.1", () => {
        // 4. Redirect to Backend with the Challenge
        const authUrl = `${BACKEND_URL}/auth/github?code_challenge=${codeChallenge}&state=xyz123`;
        console.log('Opening browser for authentication...');
        open(authUrl); 
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

program.parse();