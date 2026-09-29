require('dotenv').config();
const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SECRET_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_ANON_KEY;

const isPlaceholder =
  !supabaseUrl ||
  !supabaseKey ||
  supabaseUrl.includes("your-project-ref") ||
  supabaseKey.includes("your-supabase");

if (!supabaseUrl || !supabaseKey || isPlaceholder) {
  console.warn(
    "Supabase credentials are missing or still using placeholders. Set SUPABASE_URL and SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_ANON_KEY for limited access).",
  );
}

const supabase = !isPlaceholder ? createClient(supabaseUrl, supabaseKey) : null;

async function connectDB() {
  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase.from("custos_users").select("id").limit(1);
    if (error) throw error;
    console.log("Supabase connected successfully.");
    return true;
  } catch (error) {
    console.warn(`Supabase connection check failed: ${error.message}`);
    return false;
  }
}

module.exports = { supabase, connectDB };
