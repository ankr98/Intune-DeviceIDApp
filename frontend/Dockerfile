# --- STAGE 1: Build the React App ---
# We use the 'node' image to build the artifacts
FROM node:20-alpine AS build

WORKDIR /app

# Copy package.json and package-lock.json first (better caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the source code
COPY . .

# Build the app (Vite creates a 'dist' folder)
RUN npm run build

# --- STAGE 2: Serve with Nginx ---
# We start fresh with a tiny Nginx image
FROM nginx:alpine

# Copy the build output from Stage 1 to Nginx's html folder
COPY --from=build /app/dist /usr/share/nginx/html

# Copy our custom Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80 (Standard Web Port)
EXPOSE 80

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]