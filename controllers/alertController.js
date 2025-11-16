import { pool } from '../config/db.js';

// Get all alert types with settings (global or per-user)
export const getAlertSettings = async (req, res) => {
  try {
    const userId = req.user?.user_id;

    // Ambil alert types dengan setting (prioritas: user > global)
    const [alerts] = await pool.query(`
      SELECT 
        at.alert_type_id,
        at.type_code,
        at.type_name,
        at.description,
        at.is_system,
        COALESCE(user_als.is_enabled, global_als.is_enabled) as is_enabled,
        user_als.custom_message
      FROM alert_types at
      LEFT JOIN alert_settings global_als ON at.alert_type_id = global_als.alert_type_id AND global_als.user_id IS NULL
      LEFT JOIN alert_settings user_als ON at.alert_type_id = user_als.alert_type_id AND user_als.user_id = ?
      ORDER BY at.type_name
    `, [userId || null]);

    res.json(alerts);
  } catch (error) {
    console.error('Get alert settings error:', error.message);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// Update alert setting (toggle enabled/disabled)
export const updateAlertSetting = async (req, res) => {
  try {
    const { alert_type_id } = req.params;
    const { is_enabled, custom_message } = req.body;
    const userId = req.user?.user_id;

    if (is_enabled === undefined) {
      return res.status(400).json({ msg: 'is_enabled harus diisi' });
    }

    // Check if user-specific setting exists
    const [existing] = await pool.query(
      'SELECT * FROM alert_settings WHERE alert_type_id = ? AND user_id = ?',
      [alert_type_id, userId]
    );

    if (existing.length > 0) {
      // Update existing
      await pool.query(
        'UPDATE alert_settings SET is_enabled = ?, custom_message = ? WHERE alert_type_id = ? AND user_id = ?',
        [is_enabled, custom_message || null, alert_type_id, userId]
      );
    } else {
      // Insert new user-specific setting
      await pool.query(
        'INSERT INTO alert_settings (alert_type_id, user_id, is_enabled, custom_message) VALUES (?, ?, ?, ?)',
        [alert_type_id, userId, is_enabled, custom_message || null]
      );
    }

    res.json({ msg: 'Pengaturan alert berhasil diupdate' });
  } catch (error) {
    console.error('Update alert setting error:', error.message);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// Get login welcome data for user
export const getLoginWelcomeData = async (req, res) => {
  try {
    const userId = req.user.user_id;
    const userRole = req.user.role;

    // Check if LOGIN_WELCOME alert is enabled for this user
    const [alertCheck] = await pool.query(`
      SELECT COALESCE(user_als.is_enabled, global_als.is_enabled) as is_enabled
      FROM alert_types at
      LEFT JOIN alert_settings global_als ON at.alert_type_id = global_als.alert_type_id AND global_als.user_id IS NULL
      LEFT JOIN alert_settings user_als ON at.alert_type_id = user_als.alert_type_id AND user_als.user_id = ?
      WHERE at.type_code = 'LOGIN_WELCOME'
    `, [userId]);

    if (!alertCheck[0]?.is_enabled) {
      return res.json({ enabled: false });
    }

    // Get user info
    const [userInfo] = await pool.query(`
      SELECT u.nama_lengkap, u.email, r.nama_role, d.nama_divisi, d.kode_divisi
      FROM users u
      LEFT JOIN roles r ON u.role_id = r.role_id
      LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
      WHERE u.user_id = ?
    `, [userId]);

    const user = userInfo[0];

    // Get pending assignments (for opname users)
    const [pendingAssignments] = await pool.query(`
      SELECT COUNT(*) as count
      FROM opname_assignment oa
      WHERE oa.user_id = ? AND oa.status_assignment = 'Pending'
    `, [userId]);

    // Get total rupiah (if admin)
    let totalRupiah = 0;
    if (userRole === 1) { // Admin
      const [totalValue] = await pool.query(`
        SELECT 
          ROUND(SUM(
            CASE 
              WHEN p.konversi_pcs > 0 AND p.hje_per_karton > 0 THEN
                ((COALESCE(s.sistem_karton, 0) * p.konversi_pcs + 
                  COALESCE(s.sistem_tengah, 0) * p.konversi_tengah + 
                  COALESCE(s.sistem_pieces, 0)) / p.konversi_pcs) * p.hje_per_karton
              ELSE 0
            END
          )) as total_value
        FROM produk p
        LEFT JOIN stok_wh01 s ON p.produk_id = s.produk_id
        WHERE s.is_active = 1 
          AND p.konversi_pcs > 0 
          AND p.hje_per_karton > 0
      `);
      totalRupiah = totalValue[0]?.total_value || 0;
    }

    // Get recent activities (last 7 days)
    const [recentActivities] = await pool.query(`
      SELECT COUNT(*) as count
      FROM user_logs
      WHERE user_id = ? AND waktu >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    `, [userId]);

    // Save to user_alerts table
    const alertData = {
      pendingTasks: pendingAssignments[0]?.count || 0,
      totalRupiah,
      recentActivitiesCount: recentActivities[0]?.count || 0,
    };

    const [alertType] = await pool.query(
      "SELECT alert_type_id FROM alert_types WHERE type_code = 'LOGIN_WELCOME'"
    );

    if (alertType.length > 0) {
      await pool.query(
        'INSERT INTO user_alerts (user_id, alert_type_id, alert_message, alert_data) VALUES (?, ?, ?, ?)',
        [
          userId,
          alertType[0].alert_type_id,
          `Selamat datang, ${user.nama_lengkap}!`,
          JSON.stringify(alertData)
        ]
      );
    }

    res.json({
      enabled: true,
      user: {
        nama_lengkap: user.nama_lengkap,
        email: user.email,
        role: user.nama_role,
        divisi: user.kode_divisi ? `${user.kode_divisi} - ${user.nama_divisi}` : '-',
      },
      data: alertData,
    });

  } catch (error) {
    console.error('Get login welcome data error:', error.message);
    res.status(500).json({ msg: 'Server Error' });
  }
};

// Admin: Update global alert settings
export const updateGlobalAlertSetting = async (req, res) => {
  try {
    const { alert_type_id } = req.params;
    const { is_enabled } = req.body;

    if (is_enabled === undefined) {
      return res.status(400).json({ msg: 'is_enabled harus diisi' });
    }

    // Update global setting (user_id = NULL)
    await pool.query(
      'UPDATE alert_settings SET is_enabled = ? WHERE alert_type_id = ? AND user_id IS NULL',
      [is_enabled, alert_type_id]
    );

    res.json({ msg: 'Pengaturan global alert berhasil diupdate' });
  } catch (error) {
    console.error('Update global alert setting error:', error.message);
    res.status(500).json({ msg: 'Server Error' });
  }
};
