// path: api/controllers/dashboardController.js
import { pool } from '../config/db.js';

// Get dashboard statistics
export const getDashboardStats = async (req, res) => {
  try {
    // Total Stock Available and Product Count
    const [stockTotal] = await pool.query(
      `SELECT 
         COUNT(DISTINCT p.produk_id) as product_count,
         (
           SELECT SUM(
             CASE 
               WHEN konversi_tengah > 0 AND konversi_pcs > 0 THEN
                 (COALESCE(sistem_karton, 0) * konversi_pcs) + 
                 (COALESCE(sistem_tengah, 0) * konversi_tengah) + 
                 COALESCE(sistem_pieces, 0)
               ELSE 0
             END
           )
           FROM produk p2
           JOIN stok_wh01 s1 ON p2.produk_id = s1.produk_id
           WHERE s1.is_active = 1
         ) as total_stock
       FROM produk p`
    );

    // User Opname Performance
    const [userPerformance] = await pool.query(
      `SELECT 
         u.user_id,
         u.nama_lengkap,
         r.nama_role,
         COUNT(DISTINCT oa.assignment_id) as total_assignments,
         
         COUNT(DISTINCT CASE WHEN oa.status_assignment = 'Approved' THEN oa.assignment_id END) as approved_assignments,
         COUNT(DISTINCT CASE WHEN oa.status_assignment IN ('Submitted', 'Approved', 'Rejected') THEN oa.assignment_id END) as finished_assignments,
         
         -- DIUBAH: Menggunakan COALESCE untuk fallback ke approved_at jika submitted_at NULL.
         AVG(
           CASE 
             WHEN oa.status_assignment IN ('Submitted', 'Approved', 'Rejected') AND oa.assigned_at IS NOT NULL
             THEN 
               TIME_TO_SEC(TIMEDIFF(
                 COALESCE(oa.submitted_at, oa.approved_at), 
                 oa.assigned_at
               )) / 3600
             ELSE NULL
           END
         ) as avg_hours_per_assignment,

         -- DIUBAH: Menggunakan assigned_at (kapan tugas diberikan) sebagai ganti submitted_at (yang NULL).
         COUNT(DISTINCT CASE 
           WHEN oa.assigned_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) 
           THEN oa.assignment_id 
         END) as recent_assignments
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       LEFT JOIN opname_assignment oa ON u.user_id = oa.user_id
       WHERE u.is_active = 1
       GROUP BY u.user_id, u.nama_lengkap, r.nama_role
       HAVING recent_assignments > 0
       ORDER BY recent_assignments DESC, avg_hours_per_assignment ASC
       LIMIT 5`
    );

    // Total Active Users
    const [userCount] = await pool.query(
      'SELECT COUNT(*) as count FROM users WHERE is_active = 1'
    );

    // Active Opname Statistics
    const [opnameStats] = await pool.query(
      `SELECT 
         SUM(CASE WHEN status_overall = 'In Progress' THEN 1 ELSE 0 END) as in_progress,
         COUNT(*) as total,
         SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) as last_30_days
       FROM opname_batch`
    );

    // Stock Health Summary
    const [stockHealth] = await pool.query(
      `SELECT
         'WH01' as warehouse,
         COUNT(DISTINCT s.produk_id) as total_products,
         SUM(CASE WHEN sistem_karton > 0 OR sistem_tengah > 0 OR sistem_pieces > 0 THEN 1 ELSE 0 END) as in_stock
       FROM stok_wh01 s
       WHERE s.is_active = 1
       UNION ALL
       SELECT 
         'WH02',
         COUNT(DISTINCT s.produk_id),
         SUM(CASE WHEN sistem_total_pcs > 0 THEN 1 ELSE 0 END)
       FROM stok_wh02 s
       WHERE s.is_active = 1
       UNION ALL
       SELECT
         'WH03',
         COUNT(DISTINCT s.produk_id),
         SUM(CASE WHEN sistem_total_pcs > 0 THEN 1 ELSE 0 END)
       FROM stok_wh03 s
       WHERE s.is_active = 1`
    );

    // Division Product Summary
    const [divisionStats] = await pool.query(
      `SELECT 
         d.nama_divisi,
         COUNT(DISTINCT p.produk_id) as total_products,
         SUM(CASE 
           WHEN sw1.is_active = 1 OR sw2.is_active = 1 OR sw3.is_active = 1 
           THEN 1 ELSE 0 
         END) as active_products
       FROM divisi d
       LEFT JOIN produk p ON d.divisi_id = p.divisi_id
       LEFT JOIN stok_wh01 sw1 ON p.produk_id = sw1.produk_id AND sw1.is_active = 1
       LEFT JOIN stok_wh02 sw2 ON p.produk_id = sw2.produk_id AND sw2.is_active = 1
       LEFT JOIN stok_wh03 sw3 ON p.produk_id = sw3.produk_id AND sw3.is_active = 1
       GROUP BY d.divisi_id, d.nama_divisi`
    );

    // Recent Activity Feed
    const [recentActivity] = await pool.query(
      `SELECT 
         ul.log_id,
         ul.aktivitas,
         ul.waktu,
         u.nama_lengkap,
         u.username,
         r.nama_role,
         d.nama_divisi
       FROM user_logs ul
       JOIN users u ON ul.user_id = u.user_id
       JOIN roles r ON u.role_id = r.role_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       ORDER BY ul.waktu DESC
       LIMIT 15`
    );

    // Current Opname Progress
    const [opnameProgress] = await pool.query(
      `SELECT 
         ob.batch_id,
         ob.nama_batch,
         ob.tipe_opname,
         ob.status_overall,
         ob.created_at,
         u.nama_lengkap as created_by,
         COUNT(DISTINCT oa.assignment_id) as total_assignments,
         
         -- DIUBAH: Mengganti 'Completed' (yang tidak ada) dengan status 'selesai' yang valid.
         SUM(CASE WHEN oa.status_assignment IN ('Submitted', 'Approved', 'Rejected') THEN 1 ELSE 0 END) as completed_assignments

       FROM opname_batch ob
       JOIN users u ON ob.created_by = u.user_id
       LEFT JOIN opname_assignment oa ON ob.batch_id = oa.batch_id
       WHERE ob.status_overall = 'In Progress'
       GROUP BY ob.batch_id
       ORDER BY ob.created_at DESC
       LIMIT 5`
    );

    // Process user performance data
    const userPerformanceData = userPerformance.map(user => {
      // Calculate completion rate
      const completionRate = user.finished_assignments > 0
        ? (user.approved_assignments / user.finished_assignments) * 100
        : 0;

      // Calculate average assignments per hour (if they have timing data)
      const avgAssignmentsPerHour = user.avg_hours_per_assignment > 0
        ? 1 / user.avg_hours_per_assignment // Convert hours per assignment to assignments per hour
        : 0;

      // Determine performance score (-1 to +2)
      let performanceScore;
      if (user.recent_assignments < 5) {
        performanceScore = "0"; // Not enough data
      } else if (completionRate >= 90 && avgAssignmentsPerHour >= 0.5) {
        performanceScore = "+2"; // Excellent
      } else if (completionRate >= 75 && avgAssignmentsPerHour >= 0.3) {
        performanceScore = "+1"; // Good
      } else if (completionRate >= 60) {
        performanceScore = "0"; // Average
      } else {
        performanceScore = "-1"; // Needs improvement
      }

      return {
        id: user.user_id,
        name: user.nama_lengkap,
        role: user.nama_role,
        speed: `${avgAssignmentsPerHour.toFixed(1)} tugas/jam`,
        variance: performanceScore,
        varianceType: performanceScore === "+2" || performanceScore === "+1"
          ? "positive"
          : performanceScore === "0"
            ? "zero"
            : "negative",
        totalAssignments: user.recent_assignments // Show only recent assignments (30 days)
      };
    });

    res.json({
      totalProduk: stockTotal[0].product_count,
      totalStock: stockTotal[0].total_stock,
      totalUser: userCount[0].count,
      opnameStats: {
        inProgress: opnameStats[0].in_progress,
        total: opnameStats[0].total,
        last30Days: opnameStats[0].last_30_days
      },
      stockHealth,
      divisionStats,
      recentActivity,
      activeOpname: opnameProgress,
      userPerformance: userPerformanceData
    });

  } catch (error) {
    console.error('Error fetching dashboard stats:', error.message);
    res.status(500).json({ msg: 'Server Error', error: error.message });
  }
};

// Get additional dashboard metrics
export const getAdditionalMetrics = async (req, res) => {
  try {
    // Total Batch Completed this month
    const [completedBatch] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM opname_batch 
       WHERE status_overall = 'Completed' 
       AND MONTH(created_at) = MONTH(CURRENT_DATE())
       AND YEAR(created_at) = YEAR(CURRENT_DATE())`
    );

    // Average Completion Rate
    const [avgCompletionRate] = await pool.query(
      `SELECT 
         COUNT(DISTINCT oa.assignment_id) as total_assignments,
         SUM(CASE WHEN oa.status_assignment IN ('Submitted', 'Approved') THEN 1 ELSE 0 END) as completed_assignments
       FROM opname_assignment oa`
    );

    const completionRate = avgCompletionRate[0].total_assignments > 0
      ? (avgCompletionRate[0].completed_assignments / avgCompletionRate[0].total_assignments) * 100
      : 0;

    // Assignment Pending Approval
    const [pendingApproval] = await pool.query(
      `SELECT COUNT(*) as count 
       FROM opname_assignment 
       WHERE status_assignment = 'Submitted'`
    );

    // Top User with most tasks
    const [topUser] = await pool.query(
      `SELECT 
         u.nama_lengkap,
         r.nama_role,
         d.kode_divisi,
         d.nama_divisi,
         COUNT(DISTINCT oa.assignment_id) as task_count
       FROM users u
       JOIN roles r ON u.role_id = r.role_id
       LEFT JOIN divisi d ON u.divisi_id = d.divisi_id
       LEFT JOIN opname_assignment oa ON u.user_id = oa.user_id
       WHERE u.is_active = 1
       AND oa.assigned_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
       GROUP BY u.user_id
       ORDER BY task_count DESC
       LIMIT 1`
    );

    // Warehouse breakdown
    const [warehouseBreakdown] = await pool.query(
      `SELECT
         'WH01' as warehouse_code,
         COUNT(DISTINCT s.produk_id) as products,
         SUM(CASE WHEN sistem_karton > 0 OR sistem_tengah > 0 OR sistem_pieces > 0 THEN 1 ELSE 0 END) as in_stock,
         SUM(sistem_karton + sistem_tengah + sistem_pieces) as total_items
       FROM stok_wh01 s
       WHERE s.is_active = 1
       UNION ALL
       SELECT 
         'WH02',
         COUNT(DISTINCT s.produk_id),
         SUM(CASE WHEN sistem_total_pcs > 0 THEN 1 ELSE 0 END),
         SUM(sistem_total_pcs)
       FROM stok_wh02 s
       WHERE s.is_active = 1
       UNION ALL
       SELECT
         'WH03',
         COUNT(DISTINCT s.produk_id),
         SUM(CASE WHEN sistem_total_pcs > 0 THEN 1 ELSE 0 END),
         SUM(sistem_total_pcs)
       FROM stok_wh03 s
       WHERE s.is_active = 1`
    );

    // Total Rupiah: Sum of all products' value
    // Formula: (TOTAL IN PCS / konversi_pcs) * HJE per karton
    // Example: product 410549 with total_in_pcs=4120, konversi_pcs=88, hje=1000000
    // = (4120 / 88) * 1000000 = 46,818,181.82 → rounded to Rp46,818,182
    const [totalRupiah] = await pool.query(
      `SELECT 
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
         AND p.hje_per_karton > 0`
    );

    res.json({
      completedBatchThisMonth: completedBatch[0].count,
      avgCompletionRate: Math.round(completionRate),
      pendingApproval: pendingApproval[0].count,
      topUser: topUser[0] || { nama_lengkap: '-', nama_role: '-', nama_divisi: '-', task_count: 0 },
      warehouseBreakdown,
      totalRupiah: totalRupiah[0].total_value || 0
    });

  } catch (error) {
    console.error('Error fetching additional metrics:', error.message);
    res.status(500).json({ msg: 'Server Error', error: error.message });
  }
};

// Get monthly statistics for charts
export const getMonthlyStats = async (req, res) => {
  try {
    const { year } = req.query;
    const targetYear = year || new Date().getFullYear();

    // Stock Opname Progress by Month
    const [opnameStats] = await pool.query(
      `SELECT 
         MONTH(ob.created_at) as month,
         COUNT(DISTINCT ob.batch_id) as total_batches,
         COUNT(DISTINCT oa.assignment_id) as total_assignments,

         -- DIUBAH: Mengganti 'Completed' (yang tidak ada) dengan status 'selesai' yang valid.
         SUM(CASE WHEN oa.status_assignment IN ('Submitted', 'Approved', 'Rejected') THEN 1 ELSE 0 END) as completed_assignments,
         
         SUM(CASE WHEN ob.status_overall = 'Completed' THEN 1 ELSE 0 END) as completed_batches
       FROM opname_batch ob
       LEFT JOIN opname_assignment oa ON ob.batch_id = oa.batch_id
       WHERE YEAR(ob.created_at) = ?
       GROUP BY MONTH(ob.created_at)
       ORDER BY month`,
      [targetYear]
    );

    // Product Updates by Month (combining all warehouses)
    const [productStats] = await pool.query(
      `SELECT 
         MONTH(p.updated_at) as month,
         COUNT(DISTINCT p.produk_id) as total_products,
         SUM(CASE 
           WHEN sw1.sistem_karton > 0 OR sw1.sistem_tengah > 0 OR sw1.sistem_pieces > 0 
           OR sw2.sistem_total_pcs > 0 
           OR sw3.sistem_total_pcs > 0 
           THEN 1 ELSE 0 
         END) as in_stock_products
       FROM produk p
       LEFT JOIN stok_wh01 sw1 ON p.produk_id = sw1.produk_id AND sw1.is_active = 1
       LEFT JOIN stok_wh02 sw2 ON p.produk_id = sw2.produk_id AND sw2.is_active = 1
       LEFT JOIN stok_wh03 sw3 ON p.produk_id = sw3.produk_id AND sw3.is_active = 1
       WHERE YEAR(p.updated_at) = ?
       GROUP BY MONTH(p.updated_at)
       ORDER BY month`,
      [targetYear]
    );

    // User Activity by Month
    const [userStats] = await pool.query(
      `SELECT 
         MONTH(ul.waktu) as month,
         COUNT(DISTINCT ul.user_id) as active_users,
         COUNT(*) as total_activities
       FROM user_logs ul
       WHERE YEAR(ul.waktu) = ?
       GROUP BY MONTH(ul.waktu)
       ORDER BY month`,
      [targetYear]
    );

    // Division Progress by Month
    const [divisionStats] = await pool.query(
      `SELECT 
         MONTH(p.updated_at) as month,
         d.nama_divisi,
         COUNT(DISTINCT p.produk_id) as total_products,
         SUM(CASE 
           WHEN sw1.sistem_karton > 0 OR sw1.sistem_tengah > 0 OR sw1.sistem_pieces > 0 
           OR sw2.sistem_total_pcs > 0 
           OR sw3.sistem_total_pcs > 0 
           THEN 1 ELSE 0 
         END) as in_stock_products
       FROM produk p
       JOIN divisi d ON p.divisi_id = d.divisi_id
       LEFT JOIN stok_wh01 sw1 ON p.produk_id = sw1.produk_id AND sw1.is_active = 1
       LEFT JOIN stok_wh02 sw2 ON p.produk_id = sw2.produk_id AND sw2.is_active = 1
       LEFT JOIN stok_wh03 sw3 ON p.produk_id = sw3.produk_id AND sw3.is_active = 1
       WHERE YEAR(p.updated_at) = ?
       GROUP BY MONTH(p.updated_at), d.divisi_id
       ORDER BY month, d.nama_divisi`,
      [targetYear]
    );

    res.json({
      opnameStats,
      productStats,
      userStats,
      divisionStats,
      metadata: {
        year: targetYear,
        generatedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Error fetching monthly stats:', error.message);
    res.status(500).json({ msg: 'Server Error', error: error.message });
  }
};